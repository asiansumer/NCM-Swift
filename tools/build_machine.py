"""Author the Signal Press hard-surface model. Run with Blender --background --python.
Coordinates in helpers use the runtime's X right / Y up / Z toward viewer.
No third-party meshes. Chamfers, cut-outs and assembly are geometry, not decals.
"""
import bpy, bmesh, math, os, random
from mathutils import Vector
from mathutils.bvhtree import BVHTree
from collections import defaultdict
from pathlib import Path
bpy.ops.object.select_all(action='SELECT'); bpy.ops.object.delete(use_global=False)
ROOT=Path(__file__).resolve().parents[1]
V=lambda p: Vector((p[0],-p[2],p[1]))
M={}
def material(name,color,metal=0,rough=.4):
    m=bpy.data.materials.new(name);m.use_nodes=True
    p=m.node_tree.nodes.get('Principled BSDF');p.inputs['Base Color'].default_value=(*color,1);p.inputs['Metallic'].default_value=metal;p.inputs['Roughness'].default_value=rough
    M[name]=m;return m
material('cast-graphite',(.072,.069,.061),.42,.48)
material('brushed-aluminum',(.52,.48,.41),1,.29)
material('warm-anodized',(.64,.58,.47),.8,.32)
material('machined-steel',(.26,.27,.25),1,.23)
material('dark-steel',(.04,.043,.038),.85,.29)
material('interior',(.013,.015,.012),.28,.48)
material('rubber',(.007,.009,.007),0,.74)
material('roller-rubber',(.31,.057,.012),0,.64)
material('switch-orange',(.95,.072,.006),.16,.24)
material('ink',(.66,.63,.55),.05,.62)
material('vent',(.004,.005,.004),.2,.6)
material('glass',(.9,.95,.91),0,.06)
M['glass'].node_tree.nodes['Principled BSDF'].inputs['Transmission Weight'].default_value=1
M['glass'].node_tree.nodes['Principled BSDF'].inputs['IOR'].default_value=1.46

def active(o):
    bpy.ops.object.select_all(action='DESELECT');o.select_set(True);bpy.context.view_layer.objects.active=o

def finish(o,name,mat,bevel=0,segments=4,weighted=True):
    o.name=name
    if mat:o.data.materials.append(M[mat])
    active(o);bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
    if bevel:
        b=o.modifiers.new('Manufactured edge radius','BEVEL');b.width=bevel;b.segments=segments
        bpy.ops.object.modifier_apply(modifier=b.name)
    for p in o.data.polygons:p.use_smooth=True
    if weighted:
        n=o.modifiers.new('Face weighted normals','WEIGHTED_NORMAL');n.keep_sharp=True;n.weight=35
        bpy.ops.object.modifier_apply(modifier=n.name)
    return o

def box(name,dims,pos,mat,bevel=.03):
    bpy.ops.mesh.primitive_cube_add(size=1,location=V(pos));o=bpy.context.object;o.dimensions=(dims[0],dims[2],dims[1])
    return finish(o,name,mat,bevel,6)

def cut(o,c):
    active(o);b=o.modifiers.new('Machined recess','BOOLEAN');b.operation='DIFFERENCE';b.solver='EXACT';b.object=c
    bpy.ops.object.modifier_apply(modifier=b.name);bpy.data.objects.remove(c,do_unlink=True)

def roundrect(w,d,r,n=12):
    pts=[]
    for x,z,a in [(w/2-r,d/2-r,0),(-w/2+r,d/2-r,90),(-w/2+r,-d/2+r,180),(w/2-r,-d/2+r,270)]:
        for j in range(n):
            t=math.radians(a+j*90/n);pts.append((x+math.cos(t)*r,z+math.sin(t)*r))
    return pts

def mesh(name,verts,faces,mat):
    m=bpy.data.meshes.new(name);m.from_pydata([V(v) for v in verts],[],faces);m.update();bm=bmesh.new();bm.from_mesh(m);bmesh.ops.remove_doubles(bm,verts=list(bm.verts),dist=.00001);bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces));bm.to_mesh(m);bm.free();o=bpy.data.objects.new(name,m);bpy.context.collection.objects.link(o)
    return finish(o,name,mat,0,weighted=False)

def plate(name,w,d,r,h,pos,mat,edge=.012):
    p=roundrect(w,d,r);N=len(p);vs=[(x+pos[0],pos[1]+s*h/2,z+pos[2]) for s in [-1,1] for x,z in p]
    fs=[tuple(range(N-1,-1,-1)),tuple(range(N,2*N))]+[(i,(i+1)%N,(i+1)%N+N,i+N) for i in range(N)]
    o=mesh(name,vs,fs,mat);return finish(o,name,None,edge,3)

def panel(name,w,h,r,d,pos,mat,edge=.008):
    o=plate(name,w,h,r,d,(0,0,0),mat,edge)
    o.rotation_euler[0]=math.pi/2;o.location=V(pos)
    active(o);bpy.ops.object.transform_apply(location=False,rotation=True,scale=False)
    return o

def loft(name,rings,pos,mat):
    # Rings are (width, depth, corner radius, height, rear lift). Closed quad shell.
    verts=[]
    for w,d,r,y,tilt in rings:
        for x,z in roundrect(w,d,r):verts.append((x+pos[0],y+pos[1]+tilt*(.5-z/d),z+pos[2]))
    N=48;faces=[]
    for j in range(len(rings)-1):
        for i in range(N):faces.append((j*N+i,j*N+(i+1)%N,(j+1)*N+(i+1)%N,(j+1)*N+i))
    return mesh(name,verts,faces,mat)

def lathe(name,profile,pos,mat):
    # Axial profile (x, radius) around X. Rounded shoulders are explicitly modeled.
    n=72;vs=[(pos[0]+x,pos[1]+r*math.cos(j*2*math.pi/n),pos[2]+r*math.sin(j*2*math.pi/n)) for x,r in profile for j in range(n)]
    fs=[]
    for k in range(len(profile)-1):
        for j in range(n):fs.append((k*n+j,k*n+(j+1)%n,(k+1)*n+(j+1)%n,(k+1)*n+j))
    return mesh(name,vs,fs,mat)

def cyl(name,r,h,pos,mat,axis='x',bevel=.01):
    bpy.ops.mesh.primitive_cylinder_add(vertices=64,radius=r,depth=h,location=V(pos));o=bpy.context.object
    if axis=='x':o.rotation_euler[1]=math.pi/2
    elif axis=='z':o.rotation_euler[0]=math.pi/2
    return finish(o,name,mat,bevel,4)

# Deep continuous die-cast shell, rather than a flat extrusion with empty holes.
housing=box('housing',(6.5,2.78,2.6),(0,1.76,0),'cast-graphite',.24)
window=box('window-cutter',(4.74,1.67,2.35),(-.54,1.85,.74),None,.14);cut(housing,window)
slot=box('exit-cutter',(4.12,.28,1.02),(-.56,.76,1.22),None,.10);cut(housing,slot)
# A fine bevel on aperture edges catches light without bright cartoon outlines.
finish(housing,'housing',None,.015,3)
box('cavity-back',(4.63,1.52,.06),(-.54,1.85,-.43),'interior',.07)
box('cavity-floor',(4.53,.05,1.57),(-.54,1.12,.39),'dark-steel',.02)
# The removable side cover has a real narrow gasket line.
side=box('side-cap',(.16,2.63,2.43),(3.18,1.76,-.015),'cast-graphite',.07)
box('side-gasket',(.018,2.48,2.25),(3.097,1.76,-.02),'rubber',.006)
# Rounded contours are independent of metal sheet thickness.
plate('lid-gasket',4.29,2.08,.28,.036,(.75,3.152,-.04),'rubber',.008)
lid=plate('lid',4.21,2.01,.26,.058,(.75,3.19,-.04),'warm-anodized',.016)
slot=plate('lid-slot',3.1,.052,.025,.13,(.73,3.20,.16),None,.003);cut(lid,slot);finish(lid,'lid',None,0)
plate('slot-black',3.08,.043,.021,.006,(.73,3.224,.16),'vent',.002)
plate('intake-gasket',1.58,1.79,.22,.04,(-2.05,3.16,-.10),'rubber',.008)
# A tapered, concave inlet with rolled rim and dark throat.
loft('intake',[(1.14,1.10,.16,0,0),(1.18,1.16,.17,.025,.035),(1.28,1.34,.19,.07,.18),(1.45,1.61,.22,.14,.35),(1.57,1.76,.25,.20,.42),(1.58,1.77,.25,.225,.42),(1.56,1.75,.245,.24,.42),(1.53,1.72,.23,.23,.42),(1.42,1.59,.21,.14,.35),(1.25,1.32,.17,.07,.18),(1.15,1.13,.14,.015,.035),(1.14,1.10,.16,0,0)],(-2.05,3.18,-.10),'brushed-aluminum')
plate('intake-throat',1.13,1.10,.16,.02,(-2.05,3.184,-.10),'vent',.005)
# Shaft, bearing blocks, guide rail and restraint behind the glazed aperture.
cyl('shaft',.102,4.27,(-.66,1.88,.62),'machined-steel',bevel=.012)
for x in [-2.49,.39]:
    box('bearing-pedestal',(.22,.79,.34),(x,1.65,.32),'interior',.045)
    cyl('bearing-body',.235,.18,(x,1.88,.62),'dark-steel',bevel=.025)
    cyl('bearing-collar',.163,.205,(x,1.88,.62),'machined-steel',bevel=.018)
    box('bearing-foot',(.44,.10,.59),(x,1.22,.39),'dark-steel',.025)
box('paper-guide',(3.48,.035,.59),(-1.03,1.15,.68),'dark-steel',.012)
for i,(x,r,l) in enumerate([(-1.65,.635,1.04),(-.23,.59,.78)]):
    group=bpy.data.objects.new('roller-'+str(i),None);bpy.context.collection.objects.link(group);group.location=V((x,1.88,.62))
    before=set(bpy.data.objects)
    profile=[(-l/2,.0),(-l/2,.42),(-l/2,.54*r/.635),(-l/2+.008,r-.035),(-l/2+.025,r-.012),(-l/2+.047,r),(-l/2+.1,r+.002),(l/2-.1,r+.002),(l/2-.047,r),(l/2-.025,r-.012),(l/2-.008,r-.035),(l/2,.54*r/.635),(l/2,.42),(l/2,0)]
    lathe('orange-sleeve',profile,(x,1.88,.62),'roller-rubber')
    for s in [-1,1]:
        # Anodized recessed hub, turned steel collar, dark spindle recess.
        lathe('hub',[(-.055,.10),(-.055,.355),(-.035,.38),(.018,.38),(.035,.354),(.035,.25),(.025,.24),(.025,.1)],(x+s*(l/2+.015),1.88,.62),'dark-steel')
        cyl('turned-collar',.245,.115,(x+s*(l/2+.08),1.88,.62),'machined-steel',bevel=.018)
        cyl('collar-ring',.253,.018,(x+s*(l/2+.105),1.88,.62),'dark-steel',bevel=.005)
        cyl('hub-center',.13,.135,(x+s*(l/2+.09),1.88,.62),'dark-steel',bevel=.014)
    for o in set(bpy.data.objects)-before:
        mw=o.matrix_world.copy();o.parent=group;o.matrix_world=mw
# Window gasket and fine bevelled edge. Glass is a single thin closed sheet.
frame=panel('window-bezel',4.77,1.70,.14,.072,(-.54,1.85,1.306),'dark-steel')
cut(frame,panel('bezel-opening',4.64,1.58,.11,.3,(-.54,1.85,1.306),None));finish(frame,'window-bezel',None,0)
panel('glass',4.62,1.56,.105,.028,(-.54,1.85,1.343),'glass',.004)
box('display-housing',(1.10,1.43,.16),(1.16,1.85,1.08),'interior',.025)
# Recessed start switch with metal ring and rounded orange cap.
cyl('button-rim',.274,.075,(2.55,1.50,1.325),'dark-steel','z',.018)
cyl('button-reflector',.250,.028,(2.55,1.50,1.376),'machined-steel','z',.008)
cyl('button',.235,.092,(2.55,1.50,1.423),'switch-orange','z',.034)
# Tray: gently dished stamped sheet; curved corners and a fully rolled lip.
loft('output-tray',[(3.77,1.80,.18,0,0),(3.89,1.90,.22,.01,0),(4.03,2.00,.25,.07,0),(4.04,2.01,.25,.085,0),(4.02,1.99,.25,.10,0),(3.99,1.96,.24,.105,0),(3.87,1.87,.21,.04,0),(3.75,1.77,.17,.035,0)],(-.56,.45,2.19),'brushed-aluminum')
plate('tray-floor',3.77,1.80,.18,.036,(-.56,.468,2.19),'brushed-aluminum',.006)
box('exit-dark',(4.02,.21,.42),(-.56,.76,1.0),'vent',.04)
for x in [-2.53,2.53]:
    for z in [-.79,.71]:box('isolating-foot',(.64,.28,.58),(x,.23,z),'rubber',.07)
for j in range(9):box('side-vent',(.012,.63,.04),(3.265,1.67,-.84+j*.13),'vent',.004)
# Physical lettering prevents stretched rectangular labels.
bold=bpy.data.fonts.load('/System/Library/Fonts/Supplemental/Arial Narrow Bold.ttf')
mono=bpy.data.fonts.load('/System/Library/Fonts/Supplemental/Andale Mono.ttf')
def text(body,size,pos,font,spacing=1):
    c=bpy.data.curves.new('legend','FONT');c.body=body;c.font=font;c.size=size;c.space_character=spacing;c.extrude=0;c.resolution_u=4
    o=bpy.data.objects.new('legend-'+body,c);bpy.context.collection.objects.link(o);o.location=V(pos);o.rotation_euler[0]=math.pi/2;c.materials.append(M['ink']);active(o);bpy.ops.object.convert(target='MESH')
text('NCM',.20,(2.23,2.46,1.306),bold);text('SWIFT.',.20,(2.23,2.28,1.306),bold)
text('START',.082,(2.40,1.04,1.306),mono,1.1)
text('S O U N D',.058,(2.25,.74,1.306),mono);text('R E F O R M E D .',.055,(2.25,.64,1.306),mono)
# The delivery bed drops away from the output aperture; paper follows this same plane.
for name in ['output-tray','tray-floor']:
    o=bpy.data.objects[name]
    for v in o.data.vertices:
        z=-v.co.y
        if name=='output-tray' and z<1.63 and v.co.z>.486:
            reveal=max(0,min(1,(z-1.43)/.20));v.co.z=.486+(v.co.z-.486)*reveal
        v.co.z += .132-.10*(z-2.19)
    o.data.update();finish(o,name,None,0)
# Project UVs for fine surface roughness; sheet contours keep their physical edge geometry.
for o in list(bpy.data.objects):
    if o.type=='MESH' and not o.data.uv_layers:
        active(o);bpy.ops.object.mode_set(mode='EDIT');bpy.ops.mesh.select_all(action='SELECT');bpy.ops.uv.smart_project(angle_limit=1.15,island_margin=.015);bpy.ops.object.mode_set(mode='OBJECT')
# Subtle baked contact occlusion in vertex colors. No screen-space halo and zero per-frame AO cost.
# Vertex colors modulate albedo only; metallic highlights remain physically lit at runtime.
objects=[o for o in bpy.data.objects if o.type=='MESH']
bpy.context.view_layer.update()
verts=[];polys=[]
for o in objects:
    if o.name=='glass':continue
    offset=len(verts);verts += [o.matrix_world@v.co for v in o.data.vertices]
    polys += [tuple(offset+i for i in p.vertices) for p in o.data.polygons]
bvh=BVHTree.FromPolygons(verts,polys)
random.seed(19)
dirs=[]
for j in range(24):
    z=(j+.5)/24;a=j*2.39996323;r=math.sqrt(1-z*z);dirs.append(Vector((r*math.cos(a),r*math.sin(a),z)))
for o in objects:
    if o.name=='glass' or o.name.startswith('legend'):continue
    m=o.data;norm=o.matrix_world.to_3x3().inverted().transposed();cache={}
    attr=m.color_attributes.new(name='Contact',type='FLOAT_COLOR',domain='CORNER')
    for loop in m.loops:
        v=m.vertices[loop.vertex_index];n=(norm@v.normal).normalized();key=loop.vertex_index
        if key not in cache:
            origin=o.matrix_world@v.co+n*.006;q=Vector((0,0,1)).rotation_difference(n);occluded=0
            for d in dirs:
                hit,_,_,distance=bvh.ray_cast(origin,q@d,.65)
                if hit is not None:occluded+=(1-distance/.65)*.82
            cache[key]=max(.28,1-occluded/len(dirs))
        a=cache[key];attr.data[loop.index].color=(a,a,a,1)
    m.color_attributes.active_color=attr
for name,m in M.items():
    if name in ['glass','ink']:continue
    nodes=m.node_tree.nodes;p=nodes['Principled BSDF'];original=tuple(p.inputs['Base Color'].default_value)
    v=nodes.new('ShaderNodeVertexColor');v.layer_name='Contact'
    mix=nodes.new('ShaderNodeMixRGB');mix.blend_type='MULTIPLY';mix.inputs[0].default_value=1;mix.inputs[1].default_value=original
    m.node_tree.links.new(v.outputs['Color'],mix.inputs[2]);m.node_tree.links.new(mix.outputs[0],p.inputs['Base Color'])
# Merge static pieces by material; keep roller pivots and switch separate.
buckets=defaultdict(list)
for o in list(bpy.data.objects):
    if o.type!='MESH' or o.name in ['glass','button']:continue
    parent=o.parent.name if o.parent else 'static'
    buckets[(parent,o.data.materials[0].name)].append(o)
for (parent,mat),items in buckets.items():
    if len(items)<2:continue
    bpy.ops.object.select_all(action='DESELECT')
    for o in items:o.select_set(True)
    bpy.context.view_layer.objects.active=items[0];bpy.ops.object.join();items[0].name=parent+'-'+mat
bpy.ops.object.select_all(action='SELECT')
path=str(ROOT/'public/machine/signal-press.glb')
bpy.ops.export_scene.gltf(filepath=path,export_format='GLB',export_apply=True,export_yup=True,export_materials='EXPORT',export_animations=False,export_cameras=False,export_lights=False,export_all_vertex_colors=True)
print('MACHINE_EXPORT',path,os.path.getsize(path),'bytes')
