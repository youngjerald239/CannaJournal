import React, { useEffect, useState, useRef, useCallback } from 'react';
import { useChatSocket } from '../lib/useChatSocket';

// Media constraints (hoisted so they are stable and not deps of hooks)
const FEED_MAX_FILES = 5;
const FEED_MAX_SIZE = 25 * 1024 * 1024; // 25MB
const FEED_MAX_IMAGE_DIM = 4000; // px

// Simple hashtag regex
const HASHTAG_RE = /#[a-zA-Z0-9_]+/g;

function highlightHashtags(text, onClick){
  if (!text) return null;
  const parts = [];
  let last = 0;
  const matches = [...text.matchAll(HASHTAG_RE)];
  if (!matches.length) return text;
  matches.forEach(m => {
    const start = m.index; const end = start + m[0].length;
    if (start>last) parts.push(text.slice(last,start));
    const tag = m[0];
    parts.push(<button key={start+tag} onClick={()=> onClick(tag)} className='text-emerald-300 hover:underline'>{tag}</button>);
    last = end;
  });
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

export default function Feed(){
  const { on, authUser } = useChatSocket(true);
  const [items, setItems] = useState([]); // feed messages
  const [cursor, setCursor] = useState(null);
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [trending, setTrending] = useState([]);
  const [filterTag, setFilterTag] = useState(null);
  const [suggested, setSuggested] = useState([]);
  const [following, setFollowing] = useState([]);
  const loaderRef = useRef(null);
  const [posting, setPosting] = useState(false);
  const [postText, setPostText] = useState('');
  const [expanded, setExpanded] = useState({}); // messageId -> { loading, replies }
  // unified posting flow (media + text submitted together on Post)
  // mediaFiles entries shape:
  // { id, file, preview, error, dims:{w,h}|null, compressedFile?, finalDims:{w,h}|null, progress:0-1, thumbnail?, uploading:boolean }
  const [mediaFiles, setMediaFiles] = useState([]);
  const [uploadProgress, setUploadProgress] = useState(0);
  const dropRef = useRef(null);
  const handleAddFiles = useCallback((files)=>{
    setMediaFiles(prev => {
      const avail = FEED_MAX_FILES - prev.length;
      if (avail <=0) return prev;
      const selected = files.slice(0, avail).map(f => {
        let error = null;
        if (f.size > FEED_MAX_SIZE) error = 'Too large';
        const preview = URL.createObjectURL(f);
        const id = Math.random().toString(36).slice(2);
        return { id, file: f, preview, error, dims: null, compressedFile: null, finalDims: null, progress: 0, thumbnail: null, uploading:false };
      });
      // For images, load to check dimensions + async compression / thumbnail
      selected.forEach(obj => {
        if (!obj.error && obj.file.type.startsWith('image')){
          const img = new Image();
            img.onload = async ()=>{
              if (img.width > FEED_MAX_IMAGE_DIM || img.height > FEED_MAX_IMAGE_DIM){
                obj.error = 'Image too big';
                setMediaFiles(cur => cur.map(c => c.id===obj.id? { ...obj }: c));
              } else {
                obj.dims = { w: img.width, h: img.height };
                // create tiny thumbnail (max 160px)
                try {
                  const thumb = await generateThumbnail(img, 160);
                  obj.thumbnail = thumb;
                } catch {}
                // attempt compression (downscale large dimensions > 1920 or size > 1.2MB)
                try {
                  const { file: compressed, dims } = await maybeCompressImage(obj.file, img, { maxDim:1920, sizeThreshold: 1.2*1024*1024 });
                  if (compressed !== obj.file){ obj.compressedFile = compressed; obj.finalDims = dims; }
                  else obj.finalDims = obj.dims; // unchanged
                } catch(e){
                  obj.finalDims = obj.dims; // fallback
                }
                setMediaFiles(cur => cur.map(c => c.id===obj.id? { ...obj }: c));
              }
            };
            img.src = obj.preview;
        }
      });
      return [...prev, ...selected];
    });
  },[]);

  const fetchFeed = useCallback(async (opts={}) => {
    if (loading) return;
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (cursor && !opts.reset) params.set('cursor', cursor);
      if (filterTag) params.set('hashtag', filterTag.replace(/^#/,'').toLowerCase());
      const res = await fetch('/feed?'+params.toString(), { credentials:'include' });
      if (res.ok){
        const j = await res.json();
        if (opts.reset){ setItems(j.messages); } else { setItems(prev => [...prev, ...j.messages]); }
        setCursor(j.nextCursor);
        setHasMore(Boolean(j.nextCursor));
      }
    } finally { setLoading(false); }
  }, [cursor, filterTag, loading]);

  async function refreshTrending(){
    const r = await fetch('/feed/trending', { credentials:'include' });
    if (r.ok) setTrending(await r.json());
  }
  async function refreshSuggested(){
    const r = await fetch('/social/suggested', { credentials:'include' });
    if (r.ok) setSuggested(await r.json());
  }
  async function refreshFollowing(){
    const r = await fetch('/social/following', { credentials:'include' });
    if (r.ok) setFollowing(await r.json());
  }

  // Intentionally exclude fetchFeed from deps: it changes when cursor/loading mutate and would cause refetch loops.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(()=>{ fetchFeed({ reset:true }); refreshTrending(); refreshSuggested(); refreshFollowing(); }, [filterTag]);
  useEffect(()=>{ const iv = setInterval(refreshTrending, 60000); return ()=> clearInterval(iv); },[]);
  // fetch news once
  useEffect(()=>{ /* news removed */ },[]);

  // Infinite scroll observer
  useEffect(()=>{
    if (!hasMore) return; const el = loaderRef.current; if (!el) return;
    const obs = new IntersectionObserver(entries => {
      if (entries[0].isIntersecting){ fetchFeed(); }
    }, { rootMargin: '200px' });
    obs.observe(el); return ()=> obs.disconnect();
  }, [hasMore, fetchFeed]);

  useEffect(()=>{
    // live updates: if a new general message arrives we could prepend (future enhancement)
    const off = on('message_new', ({ message }) => {
      // naive detection: if message in general feed (we lack type here; could extend server emit) skip unless filterTag doesn't exclude it
      if (!filterTag && message && message.content_text && message.content_type !== 'system'){ setItems(prev => [{ ...message, reactions: message.reactions||{} }, ...prev]); }
    });
    const offDel = on('message_deleted', ({ messageId }) => {
      setItems(prev => prev.filter(m=> m.id !== messageId));
    });
    return () => { off(); offDel(); };
  }, [on, filterTag]);

  async function deletePost(id){
    if (!window.confirm('Delete this post?')) return;
    try {
      const r = await fetch('/feed/'+id, { method:'DELETE', credentials:'include' });
      if (r.ok){
        setItems(prev => prev.filter(m=> m.id!==id));
      } else {
        console.warn('Delete failed');
      }
    } catch(e){ console.warn('Delete error', e); }
  }

  function pickTag(tag){ setItems([]); setCursor(null); setFilterTag(tag); }
  function clearTag(){ setFilterTag(null); setItems([]); setCursor(null); }

  async function follow(u){ await fetch('/social/follow/'+u,{ method:'POST', credentials:'include'}); refreshFollowing(); refreshSuggested(); }
  async function unfollow(u){ await fetch('/social/follow/'+u,{ method:'DELETE', credentials:'include'}); refreshFollowing(); refreshSuggested(); }

  async function report(id){ const reason = prompt('Reason?'); if (!reason) return; await fetch('/messages/'+id+'/report',{ method:'POST', credentials:'include', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ reason }) }); alert('Reported'); }

  function resetMedia(){
    mediaFiles.forEach(m => m.preview && URL.revokeObjectURL(m.preview));
    setMediaFiles([]); setUploadProgress(0);
  }

  async function submitPost(e){
    e.preventDefault();
    if (!postText.trim() && mediaFiles.length===0) return;
    setPosting(true);
    try {
      let j = null;
      if (mediaFiles.length){
        const fd = new FormData();
        const valid = mediaFiles.filter(m=>!m.error);
        // append first file also under legacy single field name for backward compatibility
        if (valid[0]) fd.append('file', valid[0].compressedFile || valid[0].file);
        valid.forEach(fObj => fd.append('files', fObj.compressedFile || fObj.file));
        // include width / height arrays (final dims if available)
        valid.forEach(fObj => {
          const dims = fObj.finalDims || fObj.dims || { w:null, h:null };
          if (dims.w) fd.append('widths', String(dims.w)); else fd.append('widths','');
          if (dims.h) fd.append('heights', String(dims.h)); else fd.append('heights','');
        });
        if (postText.trim()) fd.append('text', postText.trim());
  // progress approximation per file
        // mark uploading
        setMediaFiles(cur => cur.map(m => valid.find(v=> v.id===m.id)? { ...m, uploading:true }: m));
        j = await new Promise(resolve => {
          const xhr = new XMLHttpRequest();
            xhr.open('POST','/feed/post/media');
            xhr.withCredentials = true;
            xhr.upload.onprogress = (ev)=>{ if (ev.lengthComputable){
              const pct = Math.round((ev.loaded/ev.total)*100);
              setUploadProgress(pct);
              const loaded = ev.loaded;
              setMediaFiles(cur => {
                let acc = 0;
                return cur.map(mf => {
                  if (!valid.find(v=> v.id===mf.id)) return mf; // untouched
                  const size = (mf.compressedFile || mf.file).size;
                  const start = acc; const end = acc + size; acc = end;
                  let prog;
                  if (loaded >= end) prog = 1; else if (loaded <= start) prog = 0; else prog = (loaded - start)/size;
                  return { ...mf, progress: prog };
                });
              });
            } };
            xhr.onload = () => { try { resolve(JSON.parse(xhr.responseText)); } catch{ resolve(null); } };
            xhr.onerror = ()=> resolve(null);
            xhr.send(fd);
        });
      } else {
        const r = await fetch('/feed/post',{ method:'POST', credentials:'include', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ text: postText.trim() }) });
        if (r.ok) j = await r.json();
      }
      if (j && j.message){
        setItems(prev => [j.message, ...prev]);
        setPostText('');
        resetMedia();
      }
    } finally { setPosting(false); }
  }

  async function toggleThread(m){
    setExpanded(exp => {
      const existing = exp[m.id];
      if (existing && !existing.collapsed){ return { ...exp, [m.id]: { ...existing, collapsed:true } }; }
      return { ...exp, [m.id]: existing ? { ...existing, collapsed:false } : { loading:true, replies:[], collapsed:false } };
    });
    // load if needed
    if (!expanded[m.id] || !expanded[m.id].loaded){
      try {
        const r = await fetch('/threads/'+m.id+'/replies', { credentials:'include' });
        if (r.ok){ const list = await r.json(); setExpanded(exp => ({ ...exp, [m.id]: { ...exp[m.id], replies:list, loading:false, loaded:true } })); }
        else setExpanded(exp => ({ ...exp, [m.id]: { ...exp[m.id], loading:false } }));
      } catch { setExpanded(exp => ({ ...exp, [m.id]: { ...exp[m.id], loading:false } })); }
    }
  }

  async function replyTo(rootId){
    const text = prompt('Reply:');
    if (!text || !text.trim()) return;
    const r = await fetch('/threads/'+rootId+'/replies',{ method:'POST', credentials:'include', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ text: text.trim() }) });
    if (r.ok){
      const j = await r.json();
      setExpanded(exp => {
        const cur = exp[rootId];
        if (!cur) return exp;
        return { ...exp, [rootId]: { ...cur, replies: [...(cur.replies||[]), j.message], loaded:true } };
      });
    }
  }

  const isAuthed = Boolean(authUser);
  return (
    <div className='flex h-[calc(100vh-60px)] bg-slate-950 text-emerald-50 overflow-hidden'>
      {/* Center feed */}
      <div className='flex-1 max-w-2xl mx-auto flex flex-col border-x border-emerald-400/10'>
        <div className='h-14 flex items-center px-4 border-b border-emerald-400/10 bg-slate-900/60 backdrop-blur-sm justify-between'>
          <div className='flex items-center gap-3'>
            <h1 className='text-sm font-semibold uppercase tracking-wide'>Feed</h1>
            {filterTag && <button onClick={clearTag} className='text-[11px] px-2 py-1 rounded bg-slate-800/50 hover:bg-slate-700/60 border border-emerald-400/20'>Clear {filterTag}</button>}
          </div>
          <button onClick={()=> fetchFeed({ reset:true })} className='text-[11px] px-2 py-1 rounded bg-emerald-700/40 hover:bg-emerald-600/50 border border-emerald-400/30'>Refresh</button>
        </div>
        {isAuthed ? (
          <form onSubmit={submitPost} className='p-4 border-b border-emerald-400/10 flex flex-col gap-2 bg-slate-900/40'>
            <textarea value={postText} onChange={e=> setPostText(e.target.value)} placeholder='Share something with the community...' className='w-full resize-none rounded bg-slate-800/40 border border-emerald-400/20 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-emerald-400/40 min-h-[60px]' />
            {mediaFiles.length>0 && (
              <div className='grid grid-cols-3 gap-2 w-full max-h-56 overflow-y-auto p-2 rounded border border-emerald-400/20 bg-slate-800/40 custom-scrollbar'>
                {mediaFiles.map((mf,i)=> (
                  <div key={mf.id || i} draggable className='relative group border border-emerald-400/20 rounded p-1 flex flex-col items-center justify-center bg-slate-900/40'
                    onDragStart={e=> { e.dataTransfer.setData('text/plain', String(i)); }}
                    onDragOver={e=> e.preventDefault()}
                    onDrop={e=> { e.preventDefault(); const from = parseInt(e.dataTransfer.getData('text/plain'),10); if (isNaN(from) || from===i) return; setMediaFiles(cur => { const copy=[...cur]; const [moved] = copy.splice(from,1); copy.splice(i,0,moved); return copy; }); }}
                  >
                    {mf.error && <div className='text-[10px] text-red-300 text-center px-1'>{mf.error}</div>}
                    {!mf.error && (mf.file.type.startsWith('video') ? <video src={mf.preview} className='max-h-28 rounded' controls /> : <img alt='' src={mf.thumbnail || mf.preview} className='max-h-28 object-contain rounded' />)}
                    {!mf.error && (mf.compressedFile && mf.compressedFile.size < mf.file.size) && (
                      <div className='absolute bottom-1 left-1 text-[9px] px-1 py-0.5 rounded bg-emerald-700/60 border border-emerald-300/30 text-emerald-50'>Compressed {(Math.round((mf.compressedFile.size/mf.file.size)*100))}%</div>
                    )}
                    {typeof mf.progress === 'number' && posting && (
                      <div className='absolute inset-x-1 bottom-0 h-1 rounded bg-slate-700/70 overflow-hidden'>
                        <div className='h-full bg-emerald-500 transition-all' style={{ width: ((mf.progress||0)*100)+'%' }} />
                      </div>
                    )}
                    <button type='button' onClick={()=>{ setMediaFiles(arr=> arr.filter((_,x)=> x!==i)); }} className='absolute top-1 right-1 text-[9px] px-1 py-0.5 rounded bg-slate-900/70 hover:bg-slate-800/80 border border-emerald-400/30'>✕</button>
                  </div>
                ))}
              </div>
            )}
            {uploadProgress>0 && uploadProgress<100 && (
              <div className='w-full h-2 bg-slate-800/50 rounded overflow-hidden'>
                <div className='h-full bg-emerald-500 transition-all' style={{ width: uploadProgress+'%' }} />
              </div>
            )}
            <div className='flex items-center gap-3'>
              <div className='text-[10px] text-emerald-300/40'>{postText.trim().length}/1200</div>
              <input multiple type='file' accept='image/png,image/jpeg,image/webp,video/mp4' className='hidden' id='feed-media-input'
                onChange={e=>{ const files = Array.from(e.target.files||[]); handleAddFiles(files); }} />
              <label htmlFor='feed-media-input' className='px-3 py-1.5 rounded cursor-pointer text-[14px] bg-slate-700/40 hover:bg-slate-600/50 border border-emerald-400/30' title='Add photos or video'>📷🎬</label>
              <button disabled={posting || (!postText.trim() && mediaFiles.length===0) || mediaFiles.some(f=>f.error)} className='px-4 py-1.5 rounded bg-emerald-600/70 hover:bg-emerald-500/70 disabled:opacity-40 text-[12px] border border-emerald-400/30 ml-auto'>{posting? (mediaFiles.length? (uploadProgress && uploadProgress<100? uploadProgress+'%':'Uploading...'):'Posting...'):'Post'}</button>
            </div>
            <div ref={dropRef} className='mt-2 text-[11px] border border-dashed border-emerald-400/30 rounded p-3 text-emerald-300/50 hover:border-emerald-400/50 transition bg-slate-900/30'
              onDragOver={e=>{ e.preventDefault(); }}
              onDrop={e=>{ e.preventDefault(); const files = Array.from(e.dataTransfer.files||[]); handleAddFiles(files); }}>
              Drag & drop media here (up to 5 files, max 25MB each; large images auto-downscaled soon)
            </div>
          </form>
        ) : (
          <div className='p-3 border-b border-emerald-400/10 bg-slate-900/40 text-[12px] text-emerald-300/70'>
            <a href='/login' className='underline hover:text-emerald-200'>Log in</a> to post, follow, or reply.
          </div>
        )}
        <div className='flex-1 overflow-y-auto custom-scrollbar divide-y divide-emerald-400/10'>
          {items.map((m, idx) => (
            <div key={m.id} className='p-4 hover:bg-slate-900/40 transition'>
              {m.content_type === 'news' ? (
                <div className='space-y-1'>
                  <div className='flex items-center gap-2 mb-1'>
                    <span className='text-[10px] px-2 py-0.5 rounded bg-indigo-700/40 border border-indigo-300/30 text-indigo-100'>NEWS</span>
                    <span className='text-[10px] text-emerald-300/50'>{m.metadata?.source || 'Source'}</span>
                    <span className='text-[9px] text-emerald-300/40 ml-auto'>{new Date(m.created_at).toLocaleTimeString()}</span>
                  </div>
                  <a href={m.metadata?.link} target='_blank' rel='noopener noreferrer' className='block text-sm font-medium text-emerald-100 hover:underline'>
                    {m.content_text.replace(/^\[NEWS\]\s*/,'')}
                  </a>
                  {m.metadata?.summary && <div className='text-[12px] text-emerald-300/70 line-clamp-4'>{m.metadata.summary}</div>}
                </div>
              ) : (
                <>
                  <div className='flex items-center gap-2 mb-1'>
                    <span className='text-[11px] px-2 py-0.5 rounded bg-slate-800/60 border border-emerald-400/20'>{m.sender_username||'system'}</span>
                    <span className='text-[10px] text-emerald-300/50'>{new Date(m.created_at).toLocaleTimeString()}</span>
                  </div>
                    <div className='text-sm whitespace-pre-wrap break-words leading-relaxed'>
                      {renderContent(m, pickTag)}
                  </div>
                </>
              )}
              <div className='mt-2 flex items-center gap-3 text-[11px] text-emerald-300/60'>
                <span>{m.reply_count || 0} repl{(m.reply_count||0)===1?'y':'ies'}</span>
                <span>{Object.entries(m.reactions||{}).sort((a,b)=> b[1]-a[1]).slice(0,3).map(([k,v])=> k+':'+v).join(' ') || 'No reactions'}</span>
                {isAuthed && m.sender_username && m.sender_username !== authUser && (
                  following.includes(m.sender_username) ?
                    <button onClick={()=> unfollow(m.sender_username)} className='px-2 py-0.5 rounded bg-slate-800/50 border border-emerald-400/20 hover:bg-slate-700/60'>Unfollow</button> :
                    <button onClick={()=> follow(m.sender_username)} className='px-2 py-0.5 rounded bg-emerald-700/40 border border-emerald-400/30 hover:bg-emerald-600/50'>Follow</button>
                )}
                {isAuthed && <button onClick={()=> replyTo(m.id)} className='ml-auto text-emerald-200/80 hover:text-emerald-200 text-[10px]'>Reply</button>}
                <button onClick={()=> toggleThread(m)} className='text-[10px] px-2 py-0.5 rounded bg-slate-800/40 hover:bg-slate-700/50 border border-emerald-400/20'>Thread</button>
                {isAuthed && <button onClick={()=> report(m.id)} className='text-red-300/70 hover:text-red-300 text-[10px]'>Report</button>}
                {isAuthed && m.sender_username === authUser && (
                  <button onClick={()=> deletePost(m.id)} className='text-[10px] px-2 py-0.5 rounded bg-red-800/40 hover:bg-red-700/50 border border-red-400/30'>Delete</button>
                )}
              </div>
              {expanded[m.id] && !expanded[m.id].collapsed && (
                <div className='mt-3 pl-3 border-l border-emerald-400/20 space-y-2'>
                  {expanded[m.id].loading && <div className='text-[11px] text-emerald-300/50'>Loading thread...</div>}
                  {expanded[m.id].replies && expanded[m.id].replies.map(r => (
                    <div key={r.id} className='text-[13px] p-2 rounded bg-slate-800/40 border border-emerald-400/10'>
                      <div className='flex items-center gap-2 mb-1'>
                        <span className='text-[10px] px-2 py-0.5 rounded bg-slate-900/50 border border-emerald-400/20'>{r.sender_username||'system'}</span>
                        <span className='text-[10px] text-emerald-300/40'>{new Date(r.created_at).toLocaleTimeString()}</span>
                      </div>
                      <div className='whitespace-pre-wrap break-words text-sm leading-snug'>{renderContent(r, pickTag)}</div>
                    </div>
                  ))}
                  {!expanded[m.id].loading && expanded[m.id].replies && expanded[m.id].replies.length===0 && <div className='text-[11px] text-emerald-300/40'>No replies yet.</div>}
                </div>
              )}
            </div>
          ))}
          {/* news banner removed */}
          {loading && <div className='p-4 text-[11px] text-emerald-300/50'>Loading...</div>}
          {!loading && !items.length && <div className='p-6 text-center text-[12px] text-emerald-300/40'>No posts yet.</div>}
          {hasMore && <div ref={loaderRef} className='h-12 flex items-center justify-center text-[11px] text-emerald-300/40'>Load more…</div>}
        </div>
      </div>
      {/* Right sidebar */}
      <aside className='hidden lg:flex w-72 flex-col border-l border-emerald-400/10 bg-slate-900/40 backdrop-blur-sm'>
        <div className='border-b border-emerald-400/10 p-3'>
          <h3 className='text-xs font-semibold uppercase tracking-wide mb-2 text-emerald-300/70'>Trending</h3>
          <div className='flex flex-col gap-1 max-h-56 overflow-y-auto custom-scrollbar'>
            {trending.map(t => (
              <button key={t.hashtag} onClick={()=> pickTag('#'+t.hashtag)} className='text-left text-[12px] px-2 py-1 rounded bg-slate-800/40 hover:bg-slate-800/60 border border-emerald-400/10 flex justify-between'>
                <span className='text-emerald-200'>#{t.hashtag}</span>
                <span className='text-emerald-300/50'>{t.count}</span>
              </button>
            ))}
            {!trending.length && <div className='text-[11px] text-emerald-300/50'>No hashtags</div>}
          </div>
          <div className='mt-5'>
            <h4 className='text-[11px] font-semibold uppercase tracking-wide mb-2 text-emerald-300/60'>Guides & Tips</h4>
            <a href='/guides' className='block group rounded-md p-2 bg-slate-800/30 hover:bg-slate-800/50 border border-emerald-400/10 hover:border-emerald-400/30 transition text-[12px] text-emerald-100/90'>Visit the Guides hub for rolling tutorials, consumer tips, and grower best practices →</a>
          </div>
        </div>
        <div className='p-3 border-b border-emerald-400/10'>
          <h3 className='text-xs font-semibold uppercase tracking-wide mb-2 text-emerald-300/70'>Suggested</h3>
            <div className='space-y-1 max-h-60 overflow-y-auto custom-scrollbar'>
              {suggested.filter(u=> !following.includes(u)).map(u => (
                <div key={u} className='flex items-center gap-2 px-2 py-1 rounded bg-slate-800/40 border border-emerald-400/10'>
                  <span className='text-[12px] flex-1 truncate'>{u}</span>
                  <button onClick={()=> follow(u)} className='text-[10px] px-2 py-0.5 rounded bg-emerald-700/40 hover:bg-emerald-600/50 border border-emerald-400/30'>Follow</button>
                </div>
              ))}
              {suggested.length===0 && <div className='text-[11px] text-emerald-300/50'>No suggestions</div>}
            </div>
        </div>
        <div className='p-3 text-[10px] text-emerald-300/40'>Experimental social feed prototype.</div>
      </aside>
    </div>
  );
}

function renderContent(msg, pickTag){
  const raw = msg.content_text || '';
  const tokenRe = /\[media:([^\]]+)\]/g;
  const out = [];
  let last = 0; let m;
  while ((m = tokenRe.exec(raw))){
    if (m.index > last) out.push(<span key={last}>{highlightHashtags(raw.slice(last, m.index), pickTag)}</span>);
    const mediaId = m[1];
    // Attempt to resolve attachment by id; replies may not have attachments array yet
    const att = (msg.attachments||[]).find(a=> a.id === mediaId) || (msg.attachment_url ? { id: mediaId, url: msg.attachment_url, mime: msg.mime_type || (msg.attachment_url.endsWith('.mp4')?'video/mp4':'') } : null);
    if (att){
      if (att.mime?.startsWith('video')) out.push(<video key={m.index} src={att.url} className='max-h-72 rounded border border-emerald-400/20 mt-2' controls />);
      else if (att.mime?.startsWith('image')) out.push(<img key={m.index} src={att.url} alt='' className='max-h-72 rounded border border-emerald-400/20 mt-2 object-contain' />);
      else out.push(<a key={m.index} href={att.url} target='_blank' rel='noopener noreferrer' className='text-[12px] underline text-emerald-300'>Download media</a>);
    } else out.push(<span key={m.index} className='text-emerald-300/40'>[media]</span>);
    last = m.index + m[0].length;
  }
  if (last < raw.length) out.push(<span key={last}>{highlightHashtags(raw.slice(last), pickTag)}</span>);
  return out.length? out : highlightHashtags(raw, pickTag);
}

// Utility: generate a small thumbnail DataURL from an Image element
async function generateThumbnail(imgEl, maxDim){
  const ratio = Math.min(1, maxDim / Math.max(imgEl.width, imgEl.height));
  const w = Math.round(imgEl.width * ratio); const h = Math.round(imgEl.height * ratio);
  const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(imgEl, 0,0,w,h);
  return canvas.toDataURL('image/webp', 0.6);
}

// Utility: optionally compress/downscale an image file.
// Heuristics: if original larger than maxDim OR larger than sizeThreshold then downscale to maxDim bounding box and output webp/jpeg.
async function maybeCompressImage(file, imgEl, { maxDim=1920, sizeThreshold=1_000_000 }={}){
  if (!file.type.startsWith('image')) return { file, dims:{ w: imgEl.width, h: imgEl.height } };
  const needsResize = (imgEl.width > maxDim || imgEl.height > maxDim);
  const needsSize = file.size > sizeThreshold;
  if (!needsResize && !needsSize) return { file, dims:{ w: imgEl.width, h: imgEl.height } };
  const ratio = Math.min(1, maxDim / Math.max(imgEl.width, imgEl.height));
  const w = Math.round(imgEl.width * ratio); const h = Math.round(imgEl.height * ratio);
  const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(imgEl, 0,0,w,h);
  const quality = file.type === 'image/png' ? 0.8 : 0.75;
  const mime = file.type === 'image/png' ? 'image/webp' : (file.type==='image/jpeg' ? 'image/jpeg' : 'image/webp');
  const blob = await new Promise(res => canvas.toBlob(b=> res(b||file), mime, quality));
  if (!blob) return { file, dims:{ w: imgEl.width, h: imgEl.height } };
  // Only use compressed if smaller
  if (blob.size >= file.size * 0.95) return { file, dims:{ w: imgEl.width, h: imgEl.height } };
  const compressed = new File([blob], file.name.replace(/\.(png|jpg|jpeg|webp)$/i,'') + '-cmp.' + (mime==='image/webp'?'webp':mime.split('/')[1]), { type: mime });
  return { file: compressed, dims:{ w, h } };
}

