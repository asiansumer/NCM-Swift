'use client';

/* Native images keep the DOM card identical to its WebGL texture during handoff. */
/* eslint-disable @next/next/no-img-element */

import { useCallback, useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useDropzone, type FileRejection } from 'react-dropzone';
import { PiArrowRight, PiArrowDown, PiPlus, PiPlayFill, PiPauseFill, PiDownloadSimple, PiX } from 'react-icons/pi';
import { DURATION } from './timeline';
import { convertFile, uniqueName, MAX_FILE_SIZE, type ConvertedFile } from '@/lib/convert';
import '@/app/machine/machine.css';

const MachineScene = dynamic(() => import('./scene'), { ssr: false, loading: () => <div className="machine-loading" aria-label="正在加载机器" /> });
type Failure = { name: string; error: string };

export default function Converter() {
  const [phase, setPhase] = useState<'idle' | 'working' | 'done'>('idle');
  const [results, setResults] = useState<ConvertedFile[]>([]);
  const [failures, setFailures] = useState<Failure[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [progress, setProgress] = useState({ done: 0, total: 0, percent: 0 });
  const [reduced, setReduced] = useState(false);
  const [audioId, setAudioId] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [zipBusy, setZipBusy] = useState(false);
  const [arrived, setArrived] = useState(false);
  const time = useRef(0), playing = useRef(false), count = useRef(0), processing = useRef(false);
  const dock = useRef<HTMLElement | null>(null);
  const controller = useRef<AbortController | null>(null), audio = useRef<HTMLAudioElement | null>(null);
  const urls = useRef<string[]>([]), ownedResults = useRef<ConvertedFile[]>([]);
  const stopAudio = useCallback(() => { audio.current?.pause(); audio.current = null; setAudioId(null); }, []);
  const clearResults = useCallback(() => { stopAudio(); urls.current.forEach(URL.revokeObjectURL); urls.current = []; ownedResults.current = []; setResults([]); setSelected([]); }, [stopAudio]);

  useEffect(() => {
    const query = matchMedia('(prefers-reduced-motion: reduce)');
    setReduced(query.matches);
    const change = () => setReduced(query.matches);
    query.addEventListener('change', change);
    return () => query.removeEventListener('change', change);
  }, []);
  useEffect(() => {
    let frame = 0, last = 0;
    const tick = (now: number) => {
      const delta = last && !document.hidden ? Math.min((now - last) / 1000, .05) : 0; last = now;
      if (playing.current) {
        // Processing is real. The machine holds until the worker finishes, then releases the cards.
        time.current = reduced ? (processing.current ? 3.3 : DURATION) : Math.min(processing.current ? 3.4 : DURATION, time.current + delta * 1.3);
        if (time.current >= DURATION) { playing.current = false; setArrived(true); setPhase('done'); }
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [reduced]);
  useEffect(() => () => { controller.current?.abort(); audio.current?.pause(); urls.current.forEach(URL.revokeObjectURL); }, []);
  useEffect(() => {
    if (phase !== 'working' && !results.length) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [phase, results.length]);

  const start = useCallback(async (files: File[], rejected: FileRejection[] = []) => {
    if (controller.current || zipBusy) return;
    const rejectedFiles = rejected.map(({ file, errors }) => ({ name: file.name, error: errors.some(e => e.code === 'file-too-large') ? '单个文件不能超过 100 MB' : '请选择 .ncm 文件' }));
    if (!files.length) { setFailures(rejectedFiles); return; }
    if (files.reduce((sum, file) => sum + file.size, 0) > 500 * 1024 * 1024 || files.length > 100) {
      setMessage('每批最多 100 个文件，总大小不超过 500 MB。'); return;
    }
    clearResults(); setFailures(rejectedFiles); setMessage(''); setArrived(false); setPhase('working');
    time.current = 0; count.current = Math.min(files.length, 3); processing.current = true; playing.current = true;
    const abort = new AbortController(); controller.current = abort;
    const completed: ConvertedFile[] = [], used = new Set<string>();
    setProgress({ done: 0, total: files.length, percent: 0 });
    for (let i = 0; i < files.length; i++) {
      if (abort.signal.aborted) break;
      try {
        const result = await convertFile(files[i], abort.signal, percent => setProgress({ done: i, total: files.length, percent: (i + percent / 100) / files.length * 100 }));
        if (abort.signal.aborted) break;
        const url = URL.createObjectURL(result.blob); urls.current.push(url);
        completed.push({ ...result, id: crypto.randomUUID(), name: uniqueName(files[i].name, used), url });
        ownedResults.current = [...completed]; setResults([...completed]);
      } catch (error) {
        if (abort.signal.aborted) break;
        setFailures(previous => [...previous, { name: files[i].name, error: error instanceof Error ? error.message : '转换失败，请重试' }]);
      }
      setProgress({ done: i + 1, total: files.length, percent: (i + 1) / files.length * 100 });
    }
    if (abort.signal.aborted) return;
    controller.current = null; processing.current = false; count.current = Math.min(completed.length, 3);
    setSelected(completed.map(item => item.id));
    if (!completed.length) { playing.current = false; time.current = 0; setPhase('idle'); }
  }, [clearResults, zipBusy]);
  const { getRootProps, getInputProps, open, isDragActive } = useDropzone({
    onDrop: start, accept: { 'application/octet-stream': ['.ncm'] }, maxSize: MAX_FILE_SIZE,
    noClick: true, noKeyboard: true, disabled: phase === 'working' || zipBusy,
  });
  const chooseFiles = useCallback(() => { if (phase !== 'working' && !zipBusy) open(); }, [phase, zipBusy, open]);
  function cancel() {
    controller.current?.abort(); controller.current = null; processing.current = false; playing.current = false;
    const saved = ownedResults.current; count.current = Math.min(saved.length, 3);
    time.current = saved.length ? DURATION : 0; setArrived(!!saved.length); setPhase(saved.length ? 'done' : 'idle');
    setSelected(saved.map(item => item.id)); setMessage('已取消，完成的文件已保留。');
  }
  function toggleAudio(item: ConvertedFile) {
    if (audioId === item.id) { stopAudio(); return; }
    stopAudio(); const player = new Audio(item.url); audio.current = player;
    player.addEventListener('ended', () => { if (audio.current === player) setAudioId(null); }, { once: true });
    player.play().then(() => { if (audio.current === player) setAudioId(item.id); }).catch(() => setMessage('无法试听，可下载后播放。'));
  }
  async function downloadZip() {
    const chosen = results.filter(item => selected.includes(item.id));
    if (!chosen.length || zipBusy) return;
    setZipBusy(true); setMessage('');
    try {
      const { default: JSZip } = await import('jszip'); const zip = new JSZip();
      // ArrayBuffers avoid browser/FileReader differences and preserve exact audio bytes.
      for (const item of chosen) zip.file(item.name, await item.blob.arrayBuffer());
      const blob = await zip.generateAsync({ type: 'blob', compression: 'STORE' });
      const url = URL.createObjectURL(blob); urls.current.push(url);
      const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'NCM-Swift.zip';
      document.body.appendChild(anchor); anchor.click(); anchor.remove();
    } catch { setMessage('打包失败，请重试或单独下载。'); }
    finally { setZipBusy(false); }
  }
  return <div className="machine-page">
    <div className="machine-shell">
      <header className="machine-header"><Link href="/" className="wordmark" aria-label="NCM Swift 首页">NCM SWIFT<span>.</span></Link><span className="format-label">NCM → MP3</span></header>
      <section {...getRootProps({ className: 'machine-hero' + (isDragActive ? ' dragging' : '') })} aria-label="NCM 转 MP3">
        <input {...getInputProps()} aria-label="选择 NCM 文件" />
        <div className="hero-copy">
          <h1>NCM<br/><span className="format-arrow">↳</span> MP3<span className="title-dot">.</span></h1>
          <button className="start-machine" onClick={chooseFiles} disabled={phase === 'working' || zipBusy}><PiPlus size={20}/><span>{results.length ? '再选一批' : '选择文件'}</span><PiArrowRight size={19}/></button>
          <p className="upload-hint">或拖入 .ncm 文件 · 支持批量</p>
          <div className="operation-status" aria-live="polite" aria-atomic="true">
            {phase === 'working' && <><div className="progress-caption"><span>{processing.current ? `正在转换 ${Math.min(progress.done + 1, progress.total)} / ${progress.total}` : '转换完成'} </span><button onClick={cancel} aria-label="取消转换"><PiX size={17}/></button></div><div className="conversion-progress" role="progressbar" aria-label="转换进度" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress.percent)}><span style={{ width: progress.percent + '%' }}/></div></>}
            {phase === 'done' && <div className="done-label"><span/>已完成 {results.length} 首<button className="clear-files" onClick={() => { clearResults(); setFailures([]); setMessage(''); time.current = 0; count.current = 0; setPhase('idle'); setArrived(false); }} disabled={zipBusy}>清空</button></div>}
          </div>
          {!!failures.length && <div className="file-errors" role="alert">{failures.slice(0, 3).map((item, i) => <p key={i}><span title={item.name}>{item.name}</span>{item.error}</p>)}{failures.length > 3 && <p>另有 {failures.length - 3} 个文件未能处理</p>}</div>}
          {message && <p className="machine-message" role="status">{message}<button onClick={() => setMessage('')} aria-label="关闭提示"><PiX/></button></p>}
        </div>
        <div className="hero-machine">
          <MachineScene time={time} playing={playing} count={count} reduced={reduced} onStart={chooseFiles} dock={dock}/>
          <section ref={dock} className="result-dock" id="results" aria-label="转换结果" aria-hidden={!arrived} inert={!arrived}>
            <div className="dock-heading" data-dock-heading><label className="select-all"><input type="checkbox" aria-label="全选文件" checked={results.length > 0 && selected.length === results.length} onChange={() => setSelected(selected.length === results.length ? [] : results.map(item => item.id))}/>全选<span>{results.length}</span></label><button className="batch-download" onClick={downloadZip} disabled={!selected.length || zipBusy}><PiDownloadSimple size={17}/>{zipBusy ? '打包中…' : `打包下载${selected.length ? ` · ${selected.length}` : ''}`}</button></div>
            <div className="track-list">{results.map((item, i) => <div className="track-row" key={item.id} data-result-row>
              <div className="track-art" data-ticket-target><img src="/machine/ticket.jpg" alt=""/><span>{String(i + 1).padStart(2, '0')}</span></div>
              <div className="track-reveal" data-row-reveal><label className="select-track"><input type="checkbox" aria-label={'选择 ' + item.name} checked={selected.includes(item.id)} onChange={() => setSelected(previous => previous.includes(item.id) ? previous.filter(id => id !== item.id) : [...previous, item.id])}/></label><div className="track-name"><h2 title={item.name}>{item.title}</h2><p>{item.artist ? item.artist + ' · ' : ''}MP3 · {item.blob.size < 1048576 ? Math.max(1, Math.round(item.blob.size / 1024)) + ' KB' : (item.blob.size / 1048576).toFixed(1) + ' MB'}</p></div><button className="track-play" onClick={() => toggleAudio(item)} aria-label={(audioId === item.id ? '暂停 ' : '试听 ') + item.name}>{audioId === item.id ? <PiPauseFill size={13}/> : <PiPlayFill size={13}/>}</button><a className="track-download" href={item.url} download={item.name} aria-label={'下载 ' + item.name}><PiArrowDown size={18}/></a></div>
            </div>)}</div>
          </section>
          {[0, 1, 2].map(i => <img key={i} className="flight-ticket" data-flight src="/machine/ticket.jpg" alt="" aria-hidden="true"/>)}
        </div>
        {isDragActive && <div className="drop-overlay"><PiPlus size={30}/><span>松开，开始转换</span></div>}
      </section>
      <footer className="machine-footer"><span>文件仅在你的设备上处理</span><span>© {new Date().getFullYear()} NCM SWIFT</span></footer>
    </div>
  </div>;
}
