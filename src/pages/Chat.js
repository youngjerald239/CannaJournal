import React, { useEffect, useState, useRef } from 'react';
import { useChatSocket } from '../lib/useChatSocket';
const HASHTAG_RE = /#[a-zA-Z0-9_]+/g;
function renderHashtags(text){
  if (!text) return null;
  const parts=[]; let last=0; const matches=[...text.matchAll(HASHTAG_RE)];
  if(!matches.length) return text;
  matches.forEach(m=>{ const s=m.index; const e=s+m[0].length; if(s>last) parts.push(text.slice(last,s)); parts.push(<span key={s} className='text-emerald-300 hover:underline cursor-pointer'>{m[0]}</span>); last=e; });
  if(last<text.length) parts.push(text.slice(last)); return parts;
}

function Chat() {
  const { emit, on, connected, authUser } = useChatSocket(true);
  const [conversations, setConversations] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [input, setInput] = useState('');
  const [typingUsers, setTypingUsers] = useState([]);
  const [editingId, setEditingId] = useState(null);
  const [creatingDirect, setCreatingDirect] = useState('');
  const [creatingGroup, setCreatingGroup] = useState({ title:'', members:'' });
  const [readReceipts, setReadReceipts] = useState([]);
  const [readsPointers, setReadsPointers] = useState({}); // username -> upToCreatedAt
  const [blockedUsers, setBlockedUsers] = useState([]);
  const [blockTarget, setBlockTarget] = useState('');
  const fileInputRef = useRef(null);
  const editRef = useRef(null);
  const endRef = useRef(null);
  const [showNewChat, setShowNewChat] = useState(false);
  const [userQuery, setUserQuery] = useState('');
  const [userResults, setUserResults] = useState([]);
  const [selectedUsers, setSelectedUsers] = useState([]); // for group creation via modal
  const [replyTo, setReplyTo] = useState(null);

  useEffect(()=>{
    fetch('/chat/conversations', { credentials: 'include' })
      .then(r=> r.ok? r.json(): [])
      .then(list => setConversations(list));
  },[]);

  useEffect(()=>{
    if (!connected || !activeId) return;
    emit('join_conversation', { conversationId: activeId });
  },[connected, activeId, emit]);

  useEffect(()=>{
    const offJoin = on('conversation_joined', ({ conversationId, recent, hasMore }) => {
      if (conversationId === activeId) { setMessages(recent); setHasMore(hasMore); fetchReads(conversationId); }
    });
    const offNew = on('message_new', ({ message }) => {
      if (message.conversation_id === activeId) { setMessages(m => [...m, message]); fetchReads(message.conversation_id); }
    });
    const offUpd = on('message_update', ({ message }) => {
      if (message.conversation_id === activeId) setMessages(ms => ms.map(m=> m.id===message.id? {...m, ...message}: m));
    });
    const offDel = on('message_deleted', ({ messageId }) => {
      setMessages(ms => ms.map(m=> m.id===messageId? { ...m, deleted:true }: m));
    });
    const offTyping = on('typing', ({ conversationId, username, state }) => {
      if (conversationId !== activeId) return;
      setTypingUsers(list => {
        const set = new Set(list);
        if (state === 'start') { set.add(username); }
        else { set.delete(username); }
        return Array.from(set).filter(u=>u!=='me');
      });
    });
    const offReact = on('reactions_update', ({ messageId, counts }) => {
      if (!counts) return; setMessages(ms => ms.map(m => m.id === messageId ? { ...m, reactions: counts }: m));
    });
    const offReads = on('reads_update', ({ conversationId, username, upToCreatedAt }) => {
      if (conversationId !== activeId) return;
      setReadsPointers(r => ({ ...r, [username]: upToCreatedAt }));
    });
    const offUnread = on('unread_update', ({ conversationId, unread }) => {
      setConversations(cs => cs.map(c => c.id===conversationId ? { ...c, unread_count: typeof unread==='number'? unread : c.unread_count }: c));
    });
    return () => { offJoin(); offNew(); offUpd(); offDel(); offTyping(); offReact(); offUnread(); offReads(); };
  },[on, activeId]);

  useEffect(()=>{ endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  function send(e){
    e.preventDefault();
    if (!input.trim() || !activeId) return;
    const tempId = 'tmp-'+Date.now();
    emit('send_message', { conversationId: activeId, text: input.trim(), tempId, parentMessageId: replyTo?.id || null });
    setMessages(m => [...m, { id: tempId, conversation_id: activeId, content_text: input.trim(), sender_username: authUser, created_at: new Date().toISOString() }]);
    setInput('');
    setReplyTo(null);
  }

  function startTyping(){ if (activeId) emit('typing_start', { conversationId: activeId }); }
  function stopTyping(){ if (activeId) emit('typing_stop', { conversationId: activeId }); }

  function react(mid, reaction){ emit('react_message', { messageId: mid, reaction }); }

  function beginEdit(m){ setEditingId(m.id); setInput(m.content_text||''); editRef.current?.focus(); }
  function saveEdit(){ if (!editingId) return; emit('edit_message',{ messageId: editingId, newText: input }); setEditingId(null); setInput(''); }
  function cancelEdit(){ setEditingId(null); setInput(''); }
  function del(mid){ emit('delete_message', { messageId: mid }); }

  useEffect(()=>{ if (activeId && messages.length) { const last = messages[messages.length-1]; emit('read_up_to', { conversationId: activeId, messageId: last.id }); } }, [messages, activeId, emit]);

  async function loadMore(){
    if (!activeId || loadingMore || !hasMore) return;
    setLoadingMore(true);
    const oldest = messages[0];
    const url = `/chat/conversations/${activeId}/messages?before=${encodeURIComponent(oldest.created_at)}&limit=30`;
    try {
      const res = await fetch(url, { credentials:'include' });
      if (res.ok){
        const j = await res.json();
        setMessages(ms => [...j.messages, ...ms]);
        setHasMore(j.hasMore);
      }
    } finally { setLoadingMore(false); }
  }

  async function createDirect(){
    if (!creatingDirect.trim()) return;
    const res = await fetch('/chat/direct', { method:'POST', credentials:'include', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ username: creatingDirect.trim() }) });
    if (res.ok){ const j = await res.json(); setActiveId(j.conversationId); refreshConversations(); setCreatingDirect(''); }
  }
  async function createGroup(){
    if (!creatingGroup.title.trim()) return;
    const members = creatingGroup.members.split(',').map(s=>s.trim()).filter(Boolean);
    const res = await fetch('/chat/group', { method:'POST', credentials:'include', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ title: creatingGroup.title.trim(), members }) });
    if (res.ok){ const j = await res.json(); setActiveId(j.conversationId); refreshConversations(); setCreatingGroup({ title:'', members:'' }); }
  }
  function refreshConversations(){ fetch('/chat/conversations', { credentials: 'include' }).then(r=> r.ok? r.json(): []).then(list => setConversations(list)); }

  // User search (debounced minimal)
  useEffect(()=>{
    const ctrl = new AbortController();
    const q = userQuery.trim();
    if (!q){ setUserResults([]); return; }
    const t = setTimeout(async () => {
      try {
        const r = await fetch('/chat/users/search?q='+encodeURIComponent(q), { credentials:'include', signal: ctrl.signal });
        if (r.ok){ setUserResults(await r.json()); }
      } catch(_){ /* ignore */ }
    }, 220);
    return () => { clearTimeout(t); ctrl.abort(); };
  }, [userQuery]);

  function toggleSelect(u){
    setSelectedUsers(list => list.includes(u)? list.filter(x=>x!==u): [...list,u]);
  }

  async function startNewDirect(u){
    const r = await fetch('/chat/direct',{ method:'POST', credentials:'include', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ username: u }) });
    if (r.ok){ const j = await r.json(); setActiveId(j.conversationId); refreshConversations(); setShowNewChat(false); resetNewChat(); }
  }
  async function startNewGroup(){
    if (!selectedUsers.length) return;
    const title = prompt('Group title?') || 'Group';
    const r = await fetch('/chat/group',{ method:'POST', credentials:'include', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ title, members: selectedUsers }) });
    if (r.ok){ const j = await r.json(); setActiveId(j.conversationId); refreshConversations(); setShowNewChat(false); resetNewChat(); }
  }
  function resetNewChat(){ setUserQuery(''); setUserResults([]); setSelectedUsers([]); }

  async function uploadAttachment(e){
    if (!activeId) return;
    const file = e.target.files[0];
    if (!file) return;
    const form = new FormData();
    form.append('file', file);
    const res = await fetch('/chat/upload', { method:'POST', credentials:'include', body: form });
    if (res.ok){
      const j = await res.json();
      emit('send_message', { conversationId: activeId, tempId: 'tmp-'+Date.now(), attachmentId: j.attachmentId, contentType: file.type.startsWith('video')? 'video':'image' });
    }
    fileInputRef.current.value='';
  }

  async function fetchReads(cid){
    const res = await fetch(`/chat/conversations/${cid}/reads`, { credentials:'include' });
    if (res.ok){
      const data = await res.json();
      setReadReceipts(data);
      const pointers = {};
      data.forEach(r => { if (r.last_message_created_at) pointers[r.username] = r.last_message_created_at; });
      setReadsPointers(pointers);
    }
  }

  async function fetchBlocked(){
    const res = await fetch('/chat/blocks', { credentials:'include' });
    if (res.ok){ const j = await res.json(); setBlockedUsers(j); }
  }

  useEffect(()=>{ fetchBlocked(); }, []);

  function blockUser(){ if (!blockTarget.trim()) return; emit('block_user', { target: blockTarget.trim() }); setBlockTarget(''); setTimeout(fetchBlocked, 300); }
  function unblockUser(u){ emit('unblock_user', { target: u }); setTimeout(fetchBlocked, 300); }

  function beginReply(m){ setReplyTo(m); }
  function cancelReply(){ setReplyTo(null); }

  return (
    <div className='h-[calc(100vh-60px)] flex bg-slate-950 text-emerald-50 overflow-hidden'>
      {/* Conversation List */}
      <aside className='w-64 border-r border-emerald-400/10 flex flex-col bg-gradient-to-b from-slate-900/60 to-slate-950/40 backdrop-blur-sm'>
        <div className='px-4 py-3 flex items-center justify-between border-b border-emerald-400/10'>
          <h3 className='text-sm font-semibold tracking-wide uppercase text-emerald-300/80'>Chats</h3>
          <div className='flex gap-2'>
            <button onClick={refreshConversations} className='text-[11px] px-2 py-1 rounded bg-emerald-700/30 hover:bg-emerald-600/40 border border-emerald-400/20'>↻</button>
            <button onClick={()=>{ setShowNewChat(true); resetNewChat(); }} className='text-[11px] px-2 py-1 rounded bg-emerald-700/30 hover:bg-emerald-600/40 border border-emerald-400/20'>＋</button>
          </div>
        </div>
        <div className='flex-1 overflow-y-auto custom-scrollbar px-2 py-2 space-y-1 text-sm'>
          {conversations.map(c => {
            const title = c.type === 'direct' ? (c.participants.filter(p=>p!==c.me).join(',') || 'Direct') : (c.title || 'Group');
            const active = c.id===activeId;
            const unread = Number(c.unread_count||0);
            return (
              <button key={c.id} onClick={()=> setActiveId(c.id)} className={`relative w-full text-left p-3 rounded-lg border text-[13px] leading-tight transition group ${active? 'bg-emerald-800/40 border-emerald-400/40 shadow-inner':'bg-slate-800/30 border-slate-600/30 hover:bg-slate-800/50 hover:border-emerald-400/30'}`}>
                <div className='flex items-center justify-between gap-2'>
                  <span className='font-medium truncate'>{title}</span>
                  <div className='flex items-center gap-1'>
                    {unread>0 && <span className='px-2 py-0.5 rounded-full bg-emerald-600/70 text-[10px] font-semibold text-emerald-50'>{unread}</span>}
                    <span className='text-[9px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-emerald-900/50 text-emerald-300/70 border border-emerald-400/20'>{c.type}</span>
                  </div>
                </div>
                <div className='mt-1 flex items-center justify-between text-[10px] text-emerald-300/50'>
                  <span className='truncate max-w-[110px]'>{c.last_message_text || 'No messages yet'}</span>
                  <span>{c.participants.length} member{c.participants.length!==1?'s':''}</span>
                </div>
              </button>
            );
          })}
          {conversations.length===0 && <div className='text-center text-[11px] text-emerald-300/50 py-6'>No conversations yet</div>}
        </div>
        <div className='p-3 border-t border-emerald-400/10 space-y-2'>
          <div>
            <input value={creatingDirect} onChange={e=> setCreatingDirect(e.target.value)} placeholder='Direct username' className='w-full mb-1 px-2 py-1 rounded bg-slate-800/40 border border-emerald-400/20 text-sm focus:outline-none focus:ring-1 focus:ring-emerald-400/40' />
            <button onClick={createDirect} className='w-full text-[11px] py-1 rounded bg-emerald-700/40 hover:bg-emerald-600/50 border border-emerald-400/30'>Start Direct</button>
          </div>
          <details className='group'>
            <summary className='cursor-pointer text-[11px] uppercase tracking-wide text-emerald-300/70 mb-1'>New Group</summary>
            <input value={creatingGroup.title} onChange={e=> setCreatingGroup(g=>({...g,title:e.target.value}))} placeholder='Title' className='w-full mb-1 px-2 py-1 rounded bg-slate-800/40 border border-emerald-400/20 text-sm focus:outline-none focus:ring-1 focus:ring-emerald-400/40' />
            <textarea value={creatingGroup.members} onChange={e=> setCreatingGroup(g=>({...g,members:e.target.value}))} placeholder='Members comma separated' className='w-full mb-1 px-2 py-1 rounded bg-slate-800/40 border border-emerald-400/20 text-xs focus:outline-none focus:ring-1 focus:ring-emerald-400/40 min-h-[60px]' />
            <button onClick={createGroup} className='w-full text-[11px] py-1 rounded bg-emerald-700/40 hover:bg-emerald-600/50 border border-emerald-400/30'>Create Group</button>
          </details>
        </div>
      </aside>
      {/* Main Chat Area */}
      <main className='flex-1 flex flex-col'>
        <div className='h-14 flex items-center justify-between px-4 border-b border-emerald-400/10 bg-slate-900/50 backdrop-blur-sm'>
          <div className='flex flex-col flex-1'>
            {activeId ? (
              <>
                <span className='text-sm font-semibold flex items-center gap-2'>Conversation #{activeId}</span>
                <span className='text-[10px] text-emerald-300/60 truncate'>Participants: {conversations.find(c=>c.id===activeId)?.participants.join(', ')}</span>
              </>
            ) : <span className='text-sm font-medium'>Select a conversation</span>}
          </div>
          {typingUsers.length>0 && <div className='text-[11px] text-emerald-300/70 animate-pulse'>{typingUsers.join(', ')} typing...</div>}
        </div>
        <div className='flex-1 overflow-y-auto px-4 py-4 space-y-3 custom-scrollbar' onScroll={()=> stopTyping()}>
          {hasMore && <div className='flex justify-center mb-2'><button disabled={loadingMore} onClick={loadMore} className='text-[11px] px-3 py-1 rounded-full bg-slate-800/40 hover:bg-slate-700/40 border border-emerald-400/20'>{loadingMore? 'Loading...':'Load earlier messages'}</button></div>}
          {messages.map(m => {
            const mine = m.sender_username === authUser;
            const incoming = !mine;
            if (m.content_type==='system') return (
              <div key={m.id} className='mx-auto max-w-[70%] text-center text-[11px] py-1.5 px-3 rounded-full bg-slate-900/60 border border-emerald-400/10 text-emerald-300/60 italic'>{m.content_text}</div>
            );
            return (
              <div key={m.id} className={`group max-w-[72%] ${mine? 'ml-auto':'mr-auto'} rounded-xl px-3 py-2 border relative shadow-sm ${mine? 'bg-emerald-800/40 border-emerald-400/30':'bg-slate-800/50 border-slate-600/40'} ${incoming? 'after:absolute after:-left-2 after:top-3 after:w-2 after:h-2 after:rounded-full after:bg-emerald-500/80':''}`}>
                <div className='flex items-center gap-2 mb-1'>
                  <span className='text-[10px] px-2 py-0.5 rounded-full bg-slate-900/50 border border-emerald-400/20 text-emerald-300/70'>{m.sender_username||'system'}</span>
                  {m.edited_at && <span className='text-[9px] text-emerald-300/40'>(edited)</span>}
                </div>
                <div className='text-sm whitespace-pre-wrap break-words'>
                  {m.deleted? <em className='opacity-60'>deleted</em> : (m.content_text ? renderHashtags(m.content_text) : (m.attachment_url? '' : <span className='opacity-50 italic'>empty</span>))}
                </div>
                {m.attachment_url && !m.deleted && (
                  m.mime_type?.startsWith('image') ? <div className='mt-2'><img src={m.attachment_url} alt='attachment' className='max-w-full rounded-lg border border-emerald-400/20' /></div> :
                  <div className='mt-2'><video src={m.attachment_url} controls className='max-w-full rounded-lg border border-emerald-400/20' /></div>
                )}
                {m.reactions && Object.keys(m.reactions).length ? <div className='mt-1 text-[11px] text-emerald-200/80'>{Object.entries(m.reactions).map(([k,v])=> k+':'+v).join(' ')}</div>: null}
                {Object.keys(readsPointers).length > 0 && !m.deleted && (
                  <div className='mt-1 flex flex-wrap gap-1'>
                    {readReceipts
                      .filter(r => r.username !== m.sender_username && readsPointers[r.username] && new Date(readsPointers[r.username]) >= new Date(m.created_at))
                      .slice(0,6)
                      .map(r => <span key={r.username} className='text-[9px] px-1.5 py-0.5 rounded bg-slate-900/60 border border-emerald-400/20 text-emerald-300/60'>{r.username}</span>)}
                  </div>
                )}
                {!m.deleted && <div className='opacity-0 group-hover:opacity-100 transition mt-1 flex gap-2'>
                  <button type='button' onClick={()=> react(m.id,'like')} className='text-[11px] px-2 py-0.5 rounded bg-slate-900/40 hover:bg-slate-800/60 border border-emerald-400/20'>👍</button>
                  <button type='button' onClick={()=> react(m.id,'dislike')} className='text-[11px] px-2 py-0.5 rounded bg-slate-900/40 hover:bg-slate-800/60 border border-emerald-400/20'>👎</button>
                  <button type='button' onClick={()=> beginReply(m)} className='text-[11px] px-2 py-0.5 rounded bg-slate-900/40 hover:bg-slate-800/60 border border-emerald-400/20'>Reply</button>
                  {m.sender_username===authUser && <>
                    <button type='button' onClick={()=> beginEdit(m)} className='text-[11px] px-2 py-0.5 rounded bg-slate-900/40 hover:bg-slate-800/60 border border-emerald-400/20'>Edit</button>
                    <button type='button' onClick={()=> del(m.id)} className='text-[11px] px-2 py-0.5 rounded bg-red-900/40 hover:bg-red-800/60 border border-red-400/30 text-red-200'>Del</button>
                  </>}
                </div>}
              </div>
            );
          })}
          {!messages.length && activeId && <div className='text-center text-[12px] text-emerald-300/40 pt-10'>No messages yet. Say hello 👋</div>}
          <div ref={endRef} />
        </div>
        {readReceipts.length > 0 && <div className='text-[10px] px-4 py-1 border-t border-emerald-400/10 bg-slate-900/40'>Seen by: {readReceipts.map(r=>r.username).join(', ')}</div>}
        {replyTo && (
          <div className='px-4 py-2 text-[11px] bg-slate-900/60 border-t border-emerald-400/10 flex items-center gap-3'>
            <span className='opacity-70'>Replying to</span>
            <span className='font-semibold'>{replyTo.sender_username||'system'}</span>
            <span className='truncate max-w-[240px] opacity-60'>{(replyTo.content_text||'').slice(0,120)}</span>
            <button onClick={cancelReply} className='ml-auto px-2 py-0.5 rounded bg-slate-800/40 hover:bg-slate-700/60 border border-emerald-400/20 text-[10px]'>Cancel</button>
          </div>
        )}
        <Composer 
          input={input}
          setInput={setInput}
          editingId={editingId}
          saveEdit={saveEdit}
          cancelEdit={cancelEdit}
          send={send}
          startTyping={startTyping}
          stopTyping={stopTyping}
          fileInputRef={fileInputRef}
          uploadAttachment={uploadAttachment}
        />
      </main>
      {/* Right Utility Sidebar */}
      <aside className='w-72 border-l border-emerald-400/10 p-4 flex flex-col gap-6 bg-gradient-to-b from-slate-900/60 to-slate-950/40 backdrop-blur-sm'>
        <div>
          <h4>Create Direct</h4>
          <input value={creatingDirect} onChange={e=> setCreatingDirect(e.target.value)} placeholder='username' style={{ width:'100%', marginBottom:4 }} />
          <button onClick={createDirect}>Start</button>
        </div>
        <div>
          <h4>Create Group</h4>
          <input value={creatingGroup.title} onChange={e=> setCreatingGroup(g=>({...g,title:e.target.value}))} placeholder='Title' style={{ width:'100%', marginBottom:4 }} />
          <textarea value={creatingGroup.members} onChange={e=> setCreatingGroup(g=>({...g,members:e.target.value}))} placeholder='Members comma separated' style={{ width:'100%', minHeight:60 }} />
          <button onClick={createGroup}>Create</button>
        </div>
        <div className='space-y-2'>
          <h4 className='text-sm font-semibold'>Composer Tips</h4>
          <ul className='text-[11px] leading-relaxed text-emerald-300/70 list-disc pl-4'>
            <li>Shift+Enter for newline (coming soon)</li>
            <li>Hover messages for actions</li>
            <li>Images & mp4 up to 25MB</li>
          </ul>
        </div>
        {activeId && (
          <div className='space-y-2'>
            <h4 className='text-sm font-semibold'>Add Participant</h4>
            <AddParticipant conversationId={activeId} onAdded={refreshConversations} />
          </div>
        )}
        <div className='space-y-2'>
          <h4 className='text-sm font-semibold'>Moderation</h4>
          <div className='flex gap-2'>
            <input value={blockTarget} onChange={e=> setBlockTarget(e.target.value)} placeholder='username' className='flex-1 px-2 py-1 rounded bg-slate-800/40 border border-emerald-400/20 text-sm' />
            <button onClick={blockUser} className='px-3 py-1 rounded bg-red-700/40 hover:bg-red-600/50 text-[11px] border border-red-400/30'>Block</button>
          </div>
          <div className='mt-2 max-h-32 overflow-y-auto space-y-1 custom-scrollbar'>
            {blockedUsers.length === 0 && <div className='text-[11px] text-emerald-300/50'>No blocked users</div>}
            {blockedUsers.map(b => (
              <div key={b.blocked_username} className='flex items-center justify-between text-[12px] px-2 py-1 rounded bg-slate-800/40 border border-emerald-400/10'>
                <span>{b.blocked_username}</span>
                <button onClick={()=>unblockUser(b.blocked_username)} className='text-[10px] px-2 py-0.5 rounded bg-slate-900/50 hover:bg-slate-800/60 border border-emerald-400/20'>Unblock</button>
              </div>
            ))}
          </div>
        </div>
      </aside>
      {showNewChat && (
        <div className='fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm'>
          <div className='w-full max-w-lg p-5 rounded-xl bg-gradient-to-b from-slate-900/80 to-slate-950/80 border border-emerald-400/20 shadow-xl flex flex-col gap-4'>
            <div className='flex items-center justify-between'>
              <h3 className='text-sm font-semibold tracking-wide uppercase text-emerald-300/80'>New Chat</h3>
              <button onClick={()=> setShowNewChat(false)} className='px-2 py-1 text-[11px] rounded bg-slate-800/50 hover:bg-slate-700/60 border border-emerald-400/20'>Close</button>
            </div>
            <input autoFocus value={userQuery} onChange={e=> setUserQuery(e.target.value)} placeholder='Search users...' className='px-3 py-2 rounded-lg bg-slate-800/40 border border-emerald-400/20 text-sm focus:outline-none focus:ring-1 focus:ring-emerald-400/40' />
            <div className='max-h-64 overflow-y-auto custom-scrollbar space-y-1'>
              {userResults.map(u => {
                const sel = selectedUsers.includes(u);
                return (
                  <div key={u} className='flex items-center gap-2 p-2 rounded-lg bg-slate-800/40 border border-emerald-400/10'>
                    <button onClick={()=> startNewDirect(u)} className='text-[11px] px-2 py-1 rounded bg-emerald-700/40 hover:bg-emerald-600/50 border border-emerald-400/30'>Direct</button>
                    <button onClick={()=> toggleSelect(u)} className={`flex-1 text-left text-sm truncate ${sel? 'text-emerald-200':'text-emerald-300/80'}`}>{u}</button>
                    {sel && <span className='text-[10px] px-1.5 py-0.5 rounded bg-emerald-600/50 border border-emerald-400/30'>✓</span>}
                  </div>
                );
              })}
              {!userResults.length && userQuery.trim() && <div className='text-[11px] text-emerald-300/50 p-2'>No matches</div>}
            </div>
            <div className='flex items-center justify-between pt-2'>
              <div className='text-[11px] text-emerald-300/60'>{selectedUsers.length} selected for group</div>
              <button disabled={!selectedUsers.length} onClick={startNewGroup} className='px-4 py-1.5 rounded bg-emerald-600/60 hover:bg-emerald-500/70 disabled:opacity-40 text-[11px] border border-emerald-400/30'>Create Group</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default Chat;

function Composer({ input, setInput, editingId, saveEdit, cancelEdit, send, startTyping, stopTyping, fileInputRef, uploadAttachment }){
  const [showEmoji, setShowEmoji] = useState(false);
  const textRef = useRef(null);
  const emojis = ['😀','😁','😂','🤣','😊','😍','😎','🤔','👍','🔥','💚','🌿','✨','🙌'];

  function handleKey(e){
    if (e.key === 'Enter' && !e.shiftKey){
      e.preventDefault();
      if (editingId) saveEdit(); else send(e);
    }
  }

  function insertEmoji(eChar){
    const el = textRef.current;
    if (!el){ setInput(i=> i + eChar); return; }
    const start = el.selectionStart; const end = el.selectionEnd;
    const next = input.slice(0,start) + eChar + input.slice(end);
    setInput(next);
    requestAnimationFrame(()=>{ el.focus(); el.selectionStart = el.selectionEnd = start + eChar.length; });
  }

  return (
    <div className='border-t border-emerald-400/10 p-3 flex flex-col gap-2 bg-slate-900/60 backdrop-blur-sm'>
      <div className='flex items-center gap-2'>
        <label className='cursor-pointer text-[11px] px-3 py-2 rounded-lg bg-slate-800/40 hover:bg-slate-700/50 border border-emerald-400/20'>
          <input ref={fileInputRef} type='file' accept='image/*,video/mp4' onChange={uploadAttachment} className='hidden' />
          Attach
        </label>
        <button type='button' onClick={()=> setShowEmoji(s=>!s)} className='text-[11px] px-3 py-2 rounded-lg bg-slate-800/40 hover:bg-slate-700/50 border border-emerald-400/20'>Emoji</button>
        <div className='ml-auto flex gap-2'>
          {editingId ? <>
            <button onClick={saveEdit} className='px-4 py-2 rounded-lg bg-emerald-600/70 hover:bg-emerald-500/80 text-sm font-medium'>Save</button>
            <button onClick={cancelEdit} className='px-3 py-2 rounded-lg bg-slate-700/50 hover:bg-slate-600/60 text-sm'>Cancel</button>
          </> : <button onClick={e=> send(e)} className='px-5 py-2 rounded-lg bg-emerald-600/70 hover:bg-emerald-500/80 text-sm font-medium'>Send</button>}
        </div>
      </div>
      {showEmoji && (
        <div className='p-2 rounded-lg bg-slate-900/80 border border-emerald-400/20 flex flex-wrap gap-1 max-w-sm'>
          {emojis.map(e => <button key={e} type='button' className='px-2 py-1 rounded bg-slate-800/50 hover:bg-slate-700/60 text-lg' onClick={()=> insertEmoji(e)}>{e}</button>)}
        </div>
      )}
      <textarea
        ref={textRef}
        value={input}
        onChange={e=>{ setInput(e.target.value); startTyping(); }}
        onBlur={stopTyping}
        onKeyDown={handleKey}
        placeholder={editingId? 'Edit your message (Enter to save, Shift+Enter newline)' : 'Type a message (Enter to send, Shift+Enter newline)'}
        className='w-full resize-none rounded-lg bg-slate-800/40 border border-emerald-400/20 px-3 py-2 text-sm leading-relaxed focus:outline-none focus:ring-1 focus:ring-emerald-400/40 min-h-[56px]' />
      <div className='text-[10px] text-emerald-300/40 px-1'>Enter = send  •  Shift+Enter = newline</div>
    </div>
  );
}

function AddParticipant({ conversationId, onAdded }){
  const [name, setName] = useState('');
  const [status, setStatus] = useState(null);
  async function add(){
    if (!name.trim()) return;
    setStatus(null);
    const res = await fetch(`/chat/conversations/${conversationId}/participants`, { method:'POST', credentials:'include', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ username: name.trim() }) });
    if (res.ok){ setName(''); onAdded && onAdded(); setStatus('Added'); setTimeout(()=> setStatus(null), 1200); }
    else setStatus('Failed');
  }
  return (
    <div className='p-2 rounded-lg bg-slate-800/40 border border-emerald-400/20'>
      <div className='flex gap-2'>
        <input value={name} onChange={e=> setName(e.target.value)} placeholder='username' className='flex-1 px-2 py-1 rounded bg-slate-900/40 border border-emerald-400/20 text-sm' />
        <button onClick={add} className='px-3 py-1 rounded bg-emerald-700/50 hover:bg-emerald-600/60 text-[11px]'>Add</button>
      </div>
      {status && <div className='text-[10px] mt-1 text-emerald-300/60'>{status}</div>}
    </div>
  );
}
