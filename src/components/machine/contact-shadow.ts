import * as THREE from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { HorizontalBlurShader } from 'three/addons/shaders/HorizontalBlurShader.js';
import { VerticalBlurShader } from 'three/addons/shaders/VerticalBlurShader.js';

/** Bake the actual underside once. Soft occlusion stays attached to the feet as the view moves. */
export function createContactShadow(renderer: THREE.WebGLRenderer, machine: THREE.Group) {
  const size = 512;
  const target = new THREE.WebGLRenderTarget(size, size);
  const scratch = target.clone();
  const depth = new THREE.ShaderMaterial({
    side: THREE.DoubleSide,
    vertexShader: `varying float height;
      void main() {
        vec4 world = modelMatrix * vec4(position, 1.0);
        height = max(0.0, world.y - 0.08);
        gl_Position = projectionMatrix * viewMatrix * world;
      }`,
    fragmentShader: `varying float height;
      void main() { gl_FragColor = vec4(0.0, 0.0, 0.0, exp(-height * 1.6) * 0.82); }`,
  });
  const bakeScene = new THREE.Scene();
  const parent = machine.parent!;
  bakeScene.add(machine);
  bakeScene.overrideMaterial = depth;
  const camera = new THREE.OrthographicCamera(-5, 5, 4, -4, .01, 8);
  camera.position.set(0, -.02, .5);
  camera.up.set(0, 0, 1);
  camera.lookAt(0, 1, .5);
  const previousTarget = renderer.getRenderTarget();
  const previousColor = renderer.getClearColor(new THREE.Color());
  const previousAlpha = renderer.getClearAlpha();
  renderer.setClearColor(0, 0);
  renderer.setRenderTarget(target);
  renderer.clear();
  renderer.render(bakeScene, camera);
  parent.add(machine);
  const horizontal = new THREE.ShaderMaterial(HorizontalBlurShader);
  const vertical = new THREE.ShaderMaterial(VerticalBlurShader);
  const quad = new FullScreenQuad(horizontal);
  // Two modest passes preserve the contact core while avoiding a rectangular drop shadow.
  for (const radius of [2.5, 1.2]) {
    horizontal.uniforms.tDiffuse.value = target.texture;
    horizontal.uniforms.h.value = radius / size;
    quad.material = horizontal;
    renderer.setRenderTarget(scratch);
    renderer.clear();
    quad.render(renderer);
    vertical.uniforms.tDiffuse.value = scratch.texture;
    vertical.uniforms.v.value = radius / size;
    quad.material = vertical;
    renderer.setRenderTarget(target);
    renderer.clear();
    quad.render(renderer);
  }
  renderer.setRenderTarget(previousTarget);
  renderer.setClearColor(previousColor, previousAlpha);
  const material = new THREE.MeshBasicMaterial({map: target.texture, transparent: true, depthWrite: false, toneMapped: false, side: THREE.DoubleSide});
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(10, 8), material);
  mesh.rotation.x = Math.PI / 2;
  mesh.position.set(0, .085, .5);
  mesh.renderOrder = -1;
  depth.dispose(); horizontal.dispose(); vertical.dispose(); quad.dispose(); scratch.dispose();
  return {mesh, dispose: () => {target.dispose(); material.dispose(); mesh.geometry.dispose();}};
}
