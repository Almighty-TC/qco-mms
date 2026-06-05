// ─── EXPEDITING SCREEN ────────────────────────────────────────
// Expediting register: locked POs with milestone timeline and RAG.
// Row click navigates to ExpPODetailScreen via onNavigateToPODetail prop.
// Tabs: All POs | VDRL Register (full cross-PO view) | Action Log
import React, { useState, useEffect, useCallback } from 'react'
import axios from 'axios'
import { BackButton } from '../components/BackButton'
import { Pager } from '../components/Pager'
import { usePagedList } from '../hooks/usePagedList'
import { HelpButton } from '../components/HelpDrawer'
import { MilestoneTimeline } from '../components/MilestoneTimeline'
import { MilestoneLegend } from '../components/MilestoneLegend'
import { EXPEDITING_HELP, VDRL_REGISTER_HELP } from '../helpContent'
import { ExpPODrawer } from '../components/ExpPODrawer'
import { CreateSCNWizard } from '../components/CreateSCNWizard'
import { ToastProvider, useToast } from '../hooks/useToast'

const API = 'http://localhost:3001/api'

// ─── TYPES ────────────────────────────────────────────────────
interface Milestone {
  id: number; label: string; status: string; step_order: number
  planned_date?: string | null; forecast_date?: string | null; actual_date?: string | null
  forecast_changed_count: number
}

interface PORow {
  id: number; po_number: string; po_name?: string | null
  vendor_display: string; material_description?: string | null
  owner_name?: string | null; expeditor_name?: string | null
  ros_date?: string | null; status: string
  rag: string; is_critical_path: number; milestones: Milestone[]
  group_category?: string | null
}

interface Stats {
  total_pos: number; ongoing: number; complete: number; breached: number; at_risk: number
}

interface ExpeditingScreenProps {
  dark: boolean
  projectId: number
  projectName: string
  onBack: () => void
  onNavigateToPODetail: (poId: number) => void
}

// ─── CONSTANTS ────────────────────────────────────────────────
const RAG_COLORS: Record<string, string> = {
  complete: '#22c55e', red: '#ef4444', amber: '#f59e0b', blue: '#2563eb', grey: '#94a3b8'
}
const RAG_LABELS: Record<string, string> = {
  complete: 'Complete', red: 'Breached', amber: 'At Risk', blue: 'On Track', grey: 'Not Started'
}
// ─── RAG-BASED STATUS PILLS for Expediting (not procurement status) ──────────
const RAG_STATUS_PILLS: Record<string, { bg: string; color: string; label: string }> = {
  'red':      { bg: 'rgba(239,68,68,0.12)',   color: '#dc2626', label: 'Breached' },
  'amber':    { bg: 'rgba(245,158,11,0.12)',  color: '#d97706', label: 'At Risk' },
  'blue':     { bg: 'rgba(37,99,235,0.12)',   color: '#1d4ed8', label: 'On Track' },
  'green':    { bg: 'rgba(34,197,94,0.12)',   color: '#16a34a', label: 'On Track' },
  'complete': { bg: 'rgba(34,197,94,0.12)',   color: '#16a34a', label: 'Complete' },
  'grey':     { bg: 'rgba(148,163,184,0.12)', color: '#64748b', label: 'Not Started' },
}

// ─── VDRL DOC TYPE / STATUS MAPS ─────────────────────────────
const DOC_TYPE_COLORS: Record<string,{bg:string;color:string}> = {
  'Drawing':    {bg:'rgba(37,99,235,0.1)',   color:'#1d4ed8'},
  'Datasheet':  {bg:'rgba(6,182,212,0.1)',   color:'#0e7490'},
  'Procedure':  {bg:'rgba(139,92,246,0.1)',  color:'#7c3aed'},
  'Certificate':{bg:'rgba(34,197,94,0.1)',   color:'#16a34a'},
  'Manual':     {bg:'rgba(148,163,184,0.1)', color:'#64748b'},
  'Report':     {bg:'rgba(249,115,22,0.1)',  color:'#ea580c'},
}
const VDRL_STATUS_MAP: Record<string,{bg:string;color:string;label:string}> = {
  // DB enum values (Title Case)
  'Approved':      {bg:'rgba(34,197,94,0.12)', color:'#16a34a',label:'Approved'},
  'Under review':  {bg:'rgba(37,99,235,0.12)', color:'#1d4ed8',label:'Under review'},
  'Overdue':       {bg:'rgba(239,68,68,0.12)', color:'#dc2626',label:'Overdue'},
  'Not submitted': {bg:'rgba(148,163,184,0.12)',color:'#64748b',label:'Not submitted'},
  'Resubmit':      {bg:'rgba(245,158,11,0.12)',color:'#d97706',label:'Resubmit'},
}
const fmtDateShort = (d:string|null|undefined) => d ? new Date(d).toLocaleDateString('en-AU',{day:'2-digit',month:'short'}) : '—'
const isNewDoc = (d:string) => (Date.now()-new Date(d).getTime()) < 7*86400000

// ─── VDRL DOC TABLE ───────────────────────────────────────────
// Renders a table of VDRL documents with status pills and overdue indicators.
const VDRLDocTable: React.FC<{docs:any[];dark:boolean;onRowClick:(d:any)=>void}> = ({docs,dark,onRowClick}) => {
  const col = dark?'#f1f5f9':'#0f172a'
  const bd = `1px solid ${dark?'#334155':'#dde3ed'}`
  const sub = '#94a3b8'
  if (!docs.length) return <div style={{textAlign:'center',padding:40,color:sub,fontStyle:'italic'}}>No documents in this package.</div>
  return (
    <div style={{overflowX:'auto'}}>
      <table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}>
        <thead>
          <tr style={{background:dark?'#162032':'#f8fafc',borderBottom:bd}}>
            {['DOC NO','TITLE','TYPE','REV','REQUIRED','PROMISED','SUBMITTED','STATUS','ABF'].map(h=>(
              <th key={h} style={{padding:'7px 10px',textAlign:'left',fontSize:10,fontWeight:600,color:sub,textTransform:'uppercase',letterSpacing:'0.06em',whiteSpace:'nowrap'}}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {docs.map(d => {
            const pill = VDRL_STATUS_MAP[d.status] || VDRL_STATUS_MAP['Not submitted']
            const typePill = DOC_TYPE_COLORS[d.doc_type] || {bg:'rgba(148,163,184,0.1)',color:'#64748b'}
            const isOverdue = d.status==='Overdue'
            const isNew = d.created_at && isNewDoc(d.created_at)
            return (
              <tr key={d.id} onClick={()=>onRowClick(d)}
                style={{borderBottom:bd,cursor:'pointer',borderLeft:isOverdue?'3px solid #f59e0b':isNew?'3px solid #2563eb':'3px solid transparent'}}
                onMouseEnter={e=>{(e.currentTarget as HTMLTableRowElement).style.background=dark?'#162032':'#f8fafc'}}
                onMouseLeave={e=>{(e.currentTarget as HTMLTableRowElement).style.background=''}}>
                <td style={{padding:'9px 10px',fontFamily:'JetBrains Mono, monospace',fontSize:11,color:'#2563eb',whiteSpace:'nowrap'}}>
                  {d.doc_number||'—'}
                  {isNew && <span style={{marginLeft:4,fontSize:9,padding:'1px 5px',borderRadius:9999,background:'rgba(37,99,235,0.1)',color:'#1d4ed8'}}>NEW</span>}
                  {isOverdue && <span style={{marginLeft:4,fontSize:9,padding:'1px 5px',borderRadius:9999,background:'rgba(245,158,11,0.1)',color:'#d97706'}}>ACTION</span>}
                </td>
                <td style={{padding:'9px 10px',maxWidth:200,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',color:col}} title={d.title}>{d.title}</td>
                <td style={{padding:'9px 10px',whiteSpace:'nowrap'}}>
                  {d.doc_type && <span style={{fontSize:10,padding:'2px 7px',borderRadius:9999,background:typePill.bg,color:typePill.color,fontWeight:500}}>{d.doc_type}</span>}
                </td>
                <td style={{padding:'9px 10px',fontFamily:'JetBrains Mono, monospace',fontSize:11,color:sub}}>{d.revision||'—'}</td>
                <td style={{padding:'9px 10px',fontFamily:'JetBrains Mono, monospace',fontSize:11,color:d.required_date&&new Date(d.required_date)<new Date()&&!d.submitted_date?'#ef4444':sub,whiteSpace:'nowrap'}}>{fmtDateShort(d.required_date)}</td>
                <td style={{padding:'9px 10px',fontFamily:'JetBrains Mono, monospace',fontSize:11,color:sub,whiteSpace:'nowrap'}}>{fmtDateShort(d.promised_date)}</td>
                <td style={{padding:'9px 10px',fontFamily:'JetBrains Mono, monospace',fontSize:11,color:d.submitted_date?'#22c55e':sub,whiteSpace:'nowrap'}}>{fmtDateShort(d.submitted_date)}</td>
                <td style={{padding:'9px 10px',whiteSpace:'nowrap'}}>
                  <span style={{fontSize:10,padding:'2px 7px',borderRadius:9999,background:pill.bg,color:pill.color,fontWeight:500}}>{pill.label}</span>
                </td>
                <td style={{padding:'9px 10px',textAlign:'right',whiteSpace:'nowrap'}}>
                  {d.abf_required ? <span style={{fontSize:10,padding:'2px 7px',borderRadius:9999,background:d.abf_cleared?'rgba(34,197,94,0.1)':'rgba(245,158,11,0.1)',color:d.abf_cleared?'#16a34a':'#d97706',fontWeight:500}}>{d.abf_cleared?'AFC':'C1'}</span> : <span style={{color:sub,fontSize:10}}>—</span>}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// ─── VDRL NEW PACKAGE MODAL ───────────────────────────────────
// Simple modal to create a new VDRL package for the project.
const VDRLNewPackageModal: React.FC<{dark:boolean;projectId:number;onClose:()=>void;onCreated:(pkg:any)=>void}> = ({dark,projectId,onClose,onCreated}) => {
  const [name, setName] = useState('')
  const [saving, setSaving] = useState(false)
  const col = dark?'#f1f5f9':'#0f172a'
  const cardBg = dark?'#1e293b':'#fff'
  const bd = `1px solid ${dark?'#334155':'#dde3ed'}`
  const sub = '#94a3b8'
  const save = async () => {
    if (!name.trim()) return
    setSaving(true)
    try {
      const { data } = await axios.post(`${API}/expediting/${projectId}/vdrl/packages`, { name })
      onCreated(data)
      onClose()
    } catch(e) { console.error(e) }
    setSaving(false)
  }
  return (
    <div onClick={onClose} style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.5)',zIndex:9000,display:'flex',alignItems:'center',justifyContent:'center',fontFamily:'IBM Plex Sans, sans-serif'}}>
      <div onClick={e=>e.stopPropagation()} style={{background:cardBg,border:bd,borderRadius:10,padding:24,width:420,boxShadow:'0 16px 48px rgba(0,0,0,0.4)'}}>
        <div style={{fontSize:15,fontWeight:700,color:col,marginBottom:16}}>New VDRL Package</div>
        <input value={name} onChange={e=>setName(e.target.value)} placeholder="Package name…"
          style={{width:'100%',height:36,padding:'0 10px',borderRadius:6,border:bd,background:dark?'#0f172a':'#f8fafc',color:col,fontSize:13,fontFamily:'inherit',boxSizing:'border-box',marginBottom:16}} />
        <div style={{display:'flex',justifyContent:'flex-end',gap:8}}>
          <button onClick={onClose} style={{padding:'7px 14px',borderRadius:6,border:bd,background:'none',color:sub,fontSize:12,cursor:'pointer',fontFamily:'inherit'}}>Cancel</button>
          <button onClick={save} disabled={saving||!name.trim()} style={{padding:'7px 16px',borderRadius:6,border:'none',background:'#2563eb',color:'#fff',fontSize:12,cursor:'pointer',opacity:saving||!name.trim()?0.5:1,fontFamily:'inherit'}}>
            {saving?'Creating…':'Create'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── VDRL SWITCH PACKAGE MODAL ────────────────────────────────
// Lets user pick a different active package from the list.
const VDRLSwitchPackageModal: React.FC<{dark:boolean;packages:any[];activeId:number|null;onSelect:(id:number)=>void;onClose:()=>void}> = ({dark,packages,activeId,onSelect,onClose}) => {
  const col = dark?'#f1f5f9':'#0f172a'
  const cardBg = dark?'#1e293b':'#fff'
  const bd = `1px solid ${dark?'#334155':'#dde3ed'}`
  const sub = '#94a3b8'
  return (
    <div onClick={onClose} style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.5)',zIndex:9000,display:'flex',alignItems:'center',justifyContent:'center',fontFamily:'IBM Plex Sans, sans-serif'}}>
      <div onClick={e=>e.stopPropagation()} style={{background:cardBg,border:bd,borderRadius:10,padding:24,width:480,boxShadow:'0 16px 48px rgba(0,0,0,0.4)'}}>
        <div style={{fontSize:15,fontWeight:700,color:col,marginBottom:16}}>Switch Package</div>
        {(packages||[]).map(p=>(
          <div key={p.id} onClick={()=>{onSelect(p.id);onClose()}}
            style={{padding:'10px 14px',borderRadius:8,border:p.id===activeId?'1px solid #2563eb':bd,background:p.id===activeId?'rgba(37,99,235,0.06)':'none',cursor:'pointer',marginBottom:8}}>
            <div style={{fontWeight:600,fontSize:13,color:col}}>{p.name}</div>
            <div style={{fontSize:11,color:sub}}>{p.po_number||''} · {p.vendor_name||''} · {p.doc_count||0} docs</div>
          </div>
        ))}
        <div style={{display:'flex',justifyContent:'flex-end',marginTop:8}}>
          <button onClick={onClose} style={{padding:'7px 14px',borderRadius:6,border:bd,background:'none',color:sub,fontSize:12,cursor:'pointer',fontFamily:'inherit'}}>Close</button>
        </div>
      </div>
    </div>
  )
}

// ─── VDRL ADD DOC MODAL ───────────────────────────────────────
// Simple form to add a new document to the active package.
const VDRLAddDocModal: React.FC<{dark:boolean;projectId:number;packageId:number|null;onClose:()=>void;onAdded:()=>void}> = ({dark,projectId,packageId,onClose,onAdded}) => {
  const [title, setTitle] = useState('')
  const [docType, setDocType] = useState('Drawing')
  const [revision, setRevision] = useState('R0')
  const [docNumber, setDocNumber] = useState('')
  const [requiredDate, setRequiredDate] = useState('')
  const [saving, setSaving] = useState(false)
  const col = dark?'#f1f5f9':'#0f172a'
  const cardBg = dark?'#1e293b':'#fff'
  const bd = `1px solid ${dark?'#334155':'#dde3ed'}`
  const sub = '#94a3b8'
  const inputSt = {height:32,padding:'0 9px',borderRadius:6,border:bd,background:dark?'#0f172a':'#f8fafc',color:col,fontSize:12,fontFamily:'inherit',width:'100%',boxSizing:'border-box' as const}
  const save = async () => {
    if (!title.trim()) return
    setSaving(true)
    try {
      await axios.post(`${API}/expediting/${projectId}/vdrl/documents`, {
        package_id: packageId, title, doc_type: docType, revision,
        doc_number: docNumber || null, required_date: requiredDate || null,
      })
      onAdded()
      onClose()
    } catch(e) { console.error(e) }
    setSaving(false)
  }
  return (
    <div onClick={onClose} style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.5)',zIndex:9000,display:'flex',alignItems:'center',justifyContent:'center',fontFamily:'IBM Plex Sans, sans-serif'}}>
      <div onClick={e=>e.stopPropagation()} style={{background:cardBg,border:bd,borderRadius:10,padding:24,width:480,boxShadow:'0 16px 48px rgba(0,0,0,0.4)'}}>
        <div style={{fontSize:15,fontWeight:700,color:col,marginBottom:16}}>Add Document</div>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10,marginBottom:10}}>
          <div>
            <div style={{fontSize:10,color:sub,marginBottom:4,textTransform:'uppercase'}}>Doc Number</div>
            <input value={docNumber} onChange={e=>setDocNumber(e.target.value)} placeholder="e.g. DOC-001" style={inputSt} />
          </div>
          <div>
            <div style={{fontSize:10,color:sub,marginBottom:4,textTransform:'uppercase'}}>Type</div>
            <select value={docType} onChange={e=>setDocType(e.target.value)} style={{...inputSt}}>
              {['Drawing','Datasheet','Procedure','Certificate','Manual','Report'].map(t=><option key={t}>{t}</option>)}
            </select>
          </div>
        </div>
        <div style={{marginBottom:10}}>
          <div style={{fontSize:10,color:sub,marginBottom:4,textTransform:'uppercase'}}>Title *</div>
          <input value={title} onChange={e=>setTitle(e.target.value)} placeholder="Document title…" style={inputSt} />
        </div>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10,marginBottom:16}}>
          <div>
            <div style={{fontSize:10,color:sub,marginBottom:4,textTransform:'uppercase'}}>Revision</div>
            <input value={revision} onChange={e=>setRevision(e.target.value)} placeholder="R0" style={inputSt} />
          </div>
          <div>
            <div style={{fontSize:10,color:sub,marginBottom:4,textTransform:'uppercase'}}>Required By</div>
            <input type="date" value={requiredDate} onChange={e=>setRequiredDate(e.target.value)} style={inputSt} />
          </div>
        </div>
        <div style={{display:'flex',justifyContent:'flex-end',gap:8}}>
          <button onClick={onClose} style={{padding:'7px 14px',borderRadius:6,border:bd,background:'none',color:sub,fontSize:12,cursor:'pointer',fontFamily:'inherit'}}>Cancel</button>
          <button onClick={save} disabled={saving||!title.trim()} style={{padding:'7px 16px',borderRadius:6,border:'none',background:'#22c55e',color:'#fff',fontSize:12,cursor:'pointer',opacity:saving||!title.trim()?0.5:1,fontFamily:'inherit'}}>
            {saving?'Adding…':'Add Document'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── VDRL UPLOAD MODAL ────────────────────────────────────────
// 3-step modal: dropzone → dry-run preview → success.
const VDRLUploadModal: React.FC<{dark:boolean;projectId:number;onClose:()=>void;onImported:()=>void}> = ({dark,projectId,onClose,onImported}) => {
  const [step, setStep] = useState<1|2|3>(1)
  const [file, setFile] = useState<File|null>(null)
  const [preview, setPreview] = useState<any>(null)
  const [importing, setImporting] = useState(false)
  const [parseError, setParseError] = useState('')
  const col = dark?'#f1f5f9':'#0f172a'
  const cardBg = dark?'#1e293b':'#fff'
  const bd = `1px solid ${dark?'#334155':'#dde3ed'}`
  const sub = '#94a3b8'

  const handleDryRun = async () => {
    if (!file) return
    setParseError(''); setImporting(true)
    try {
      const fd = new FormData(); fd.append('file', file)
      const { data } = await axios.post(`${API}/expediting/${projectId}/vdrl/upload?dryRun=true`, fd, { headers: { 'Content-Type': 'multipart/form-data' } })
      setPreview(data); setStep(2)
    } catch (e: any) {
      setParseError(e?.response?.data?.error || 'Failed to parse file')
    } finally { setImporting(false) }
  }

  const handleImport = async () => {
    if (!file) return
    setImporting(true)
    try {
      const fd = new FormData(); fd.append('file', file)
      await axios.post(`${API}/expediting/${projectId}/vdrl/upload`, fd, { headers: { 'Content-Type': 'multipart/form-data' } })
      setStep(3); onImported()
    } catch (e: any) {
      setParseError(e?.response?.data?.error || 'Import failed')
    } finally { setImporting(false) }
  }

  return (
    <div onClick={onClose} style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.5)',zIndex:9100,display:'flex',alignItems:'center',justifyContent:'center',fontFamily:'IBM Plex Sans, sans-serif'}}>
      <div onClick={e=>e.stopPropagation()} style={{background:cardBg,border:bd,borderRadius:12,padding:28,width:'90%',maxWidth:640,maxHeight:'90vh',overflowY:'auto',boxShadow:'0 20px 60px rgba(0,0,0,0.4)'}}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:20}}>
          <div>
            <div style={{fontSize:17,fontWeight:700,color:col}}>Upload VDRL Documents</div>
            <div style={{fontSize:12,color:sub,marginTop:2}}>Step {step} of 3</div>
          </div>
          <button onClick={onClose} style={{background:'none',border:'none',fontSize:20,color:sub,cursor:'pointer',lineHeight:1}}>×</button>
        </div>

        {/* ─── STEP 1: File drop ─── */}
        {step === 1 && (
          <div>
            <div style={{border:`2px dashed ${dark?'#334155':'#cbd5e1'}`,borderRadius:10,padding:'40px 24px',textAlign:'center',marginBottom:16,background:dark?'#0f172a':'#f8fafc',cursor:'pointer',position:'relative'}}
              onDragOver={e=>{e.preventDefault();(e.currentTarget as HTMLDivElement).style.borderColor='#2563eb'}}
              onDragLeave={e=>{(e.currentTarget as HTMLDivElement).style.borderColor=dark?'#334155':'#cbd5e1'}}
              onDrop={e=>{e.preventDefault();const f=e.dataTransfer.files[0];if(f?.name.endsWith('.xlsx')){setFile(f);setParseError('')}else setParseError('Only .xlsx files are accepted')}}>
              <input type="file" accept=".xlsx" onChange={e=>{const f=e.target.files?.[0];if(f){setFile(f);setParseError('')}}} style={{position:'absolute',inset:0,opacity:0,cursor:'pointer'}} />
              <div style={{fontSize:32,marginBottom:8}}>📄</div>
              <div style={{fontSize:13,fontWeight:600,color:col,marginBottom:4}}>{file ? file.name : 'Drop your .xlsx file here'}</div>
              <div style={{fontSize:12,color:sub}}>{file ? `${(file.size/1024).toFixed(1)} KB — ready to preview` : 'or click to browse'}</div>
            </div>
            {parseError && <div style={{color:'#dc2626',fontSize:12,marginBottom:12}}>{parseError}</div>}
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
              <a href="#" onClick={e=>{e.preventDefault();window.open(`${API}/expediting/${projectId}/vdrl/template`)}} style={{fontSize:12,color:'#2563eb',textDecoration:'none'}}>↓ Download template</a>
              <div style={{display:'flex',gap:8}}>
                <button onClick={onClose} style={{padding:'7px 14px',borderRadius:6,border:bd,background:'none',color:sub,fontSize:12,cursor:'pointer',fontFamily:'inherit'}}>Cancel</button>
                <button onClick={handleDryRun} disabled={!file||importing} style={{padding:'7px 16px',borderRadius:6,border:'none',background:'#2563eb',color:'#fff',fontSize:12,cursor:'pointer',opacity:!file||importing?0.5:1,fontFamily:'inherit'}}>
                  {importing?'Parsing…':'Preview →'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ─── STEP 2: Dry-run preview ─── */}
        {step === 2 && preview && (
          <div>
            <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:10,marginBottom:16}}>
              {[
                {label:'ROWS FOUND', value:preview.total, color:col},
                {label:'READY TO IMPORT', value:preview.preview?.filter((r:any)=>r.status==='ok').length||0, color:'#22c55e'},
                {label:'ERRORS', value:preview.errors?.length||0, color:preview.errors?.length?'#ef4444':sub},
              ].map(({label,value,color})=>(
                <div key={label} style={{background:dark?'#0f172a':'#f8fafc',border:bd,borderRadius:8,padding:'10px 14px'}}>
                  <div style={{fontSize:20,fontWeight:700,fontFamily:'JetBrains Mono, monospace',color}}>{value}</div>
                  <div style={{fontSize:10,color:sub,textTransform:'uppercase',letterSpacing:'0.06em',marginTop:2}}>{label}</div>
                </div>
              ))}
            </div>
            {preview.errors?.length > 0 && (
              <div style={{background:'rgba(239,68,68,0.05)',border:'1px solid rgba(239,68,68,0.2)',borderRadius:8,padding:'10px 14px',marginBottom:14}}>
                <div style={{fontSize:12,fontWeight:600,color:'#dc2626',marginBottom:6}}>Errors must be fixed before importing:</div>
                {preview.errors.slice(0,5).map((e:any,i:number)=>(
                  <div key={i} style={{fontSize:12,color:'#dc2626',marginBottom:3}}>Row {e.row}: {e.message} {e.docNum?`(${e.docNum})`:''}</div>
                ))}
              </div>
            )}
            <div style={{border:bd,borderRadius:8,overflow:'hidden',marginBottom:16}}>
              <table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}>
                <thead>
                  <tr style={{background:dark?'#0f172a':'#f8fafc'}}>
                    {['Row','Status','PO Ref','Doc Number','Title'].map(h=>(
                      <th key={h} style={{padding:'7px 10px',textAlign:'left',fontSize:10,fontWeight:600,color:sub,textTransform:'uppercase',letterSpacing:'0.06em',borderBottom:bd}}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(preview.preview||[]).filter((r:any)=>r.status!=='skip'||r.docNum).map((r:any,i:number)=>(
                    <tr key={i} style={{borderBottom:bd}}>
                      <td style={{padding:'6px 10px',color:sub,fontFamily:'JetBrains Mono, monospace'}}>{r.row}</td>
                      <td style={{padding:'6px 10px'}}>
                        <span style={{fontSize:10,padding:'2px 6px',borderRadius:9999,
                          background:r.status==='ok'?'rgba(34,197,94,0.1)':r.status==='error'?'rgba(239,68,68,0.1)':'rgba(148,163,184,0.1)',
                          color:r.status==='ok'?'#16a34a':r.status==='error'?'#dc2626':'#64748b',fontWeight:600}}>
                          {r.status}
                        </span>
                      </td>
                      <td style={{padding:'6px 10px',fontFamily:'JetBrains Mono, monospace',color:'#2563eb'}}>{r.poRef||'—'}</td>
                      <td style={{padding:'6px 10px',fontFamily:'JetBrains Mono, monospace',color:sub}}>{r.docNum||'—'}</td>
                      <td style={{padding:'6px 10px',color:col,maxWidth:160,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{r.title||r.message||'—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {parseError && <div style={{color:'#dc2626',fontSize:12,marginBottom:12}}>{parseError}</div>}
            <div style={{display:'flex',justifyContent:'flex-end',gap:8}}>
              <button onClick={()=>setStep(1)} style={{padding:'7px 14px',borderRadius:6,border:bd,background:'none',color:sub,fontSize:12,cursor:'pointer',fontFamily:'inherit'}}>← Back</button>
              <button onClick={handleImport} disabled={preview.hasErrors||importing} style={{padding:'7px 16px',borderRadius:6,border:'none',background:'#22c55e',color:'#fff',fontSize:12,cursor:'pointer',opacity:preview.hasErrors||importing?0.5:1,fontFamily:'inherit'}}>
                {importing?'Importing…':'✓ Import Documents'}
              </button>
            </div>
          </div>
        )}

        {/* ─── STEP 3: Success ─── */}
        {step === 3 && (
          <div style={{textAlign:'center',padding:'32px 0'}}>
            <div style={{fontSize:40,marginBottom:12}}>✅</div>
            <div style={{fontSize:15,fontWeight:700,color:col,marginBottom:6}}>Import complete</div>
            <div style={{fontSize:13,color:sub,marginBottom:24}}>VDRL documents have been added successfully.</div>
            <button onClick={onClose} style={{padding:'8px 20px',borderRadius:6,border:'none',background:'#2563eb',color:'#fff',fontSize:13,cursor:'pointer',fontFamily:'inherit'}}>Done</button>
          </div>
        )}
      </div>
    </div>
  )
}

type ActiveTab = 'pos' | 'vdrl' | 'action-log'
type RAGFilter = 'all' | 'red' | 'amber' | 'blue' | 'grey' | 'complete'
type SubTab = 'all' | 'ongoing' | 'complete'

// ─── HELPERS ──────────────────────────────────────────────────
const fmt = (d?: string | null) =>
  d ? new Date(d).toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'

// ─── INNER COMPONENT ──────────────────────────────────────────
// Must be wrapped in ToastProvider; use the exported ExpeditingScreen below.
const ExpeditingScreenInner = ({ dark, projectId, projectName, onBack, onNavigateToPODetail }: ExpeditingScreenProps) => {
  const { addToast } = useToast()
  const [stats, setStats]     = useState<Stats>({ total_pos: 0, ongoing: 0, complete: 0, breached: 0, at_risk: 0 })
  const [activeTab, setTab]   = useState<ActiveTab>('pos')
  const [subTab, setSubTab]   = useState<SubTab>('all')
  const [search, setSearch]   = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [ragFilter, setRagFilter] = useState<RAGFilter>('all')
  const [criticalOnly, setCriticalOnly] = useState(false)
  const [rosFrom, setRosFrom] = useState('')
  const [rosTo, setRosTo]     = useState('')

  // ─── VDRL STATE ───────────────────────────────────────────
  const [vdrlStats, setVdrlStats] = useState<any>(null)
  const [vdrlPackages, setVdrlPackages] = useState<any[]>([])
  const [vdrlDocs, setVdrlDocs] = useState<any[]>([])
  const [activePackageId, setActivePackageId] = useState<number | null>(null)
  const [vdrlSearch, setVdrlSearch] = useState('')
  const [vdrlStatusFilter, setVdrlStatusFilter] = useState('all')
  const [showNewPackage, setShowNewPackage] = useState(false)
  const [showSwitchPackage, setShowSwitchPackage] = useState(false)
  const [showAddDoc, setShowAddDoc] = useState(false)
  const [selectedDoc, setSelectedDoc] = useState<any>(null)
  // ─── VDRL LIST/PACKAGE VIEW STATE ────────────────────────
  const [vdrlView, setVdrlView] = useState<'list' | 'package'>('list')
  const [selectedVdrlPoId, setSelectedVdrlPoId] = useState<number | null>(null)
  const [vdrlPoList, setVdrlPoList] = useState<any[]>([])
  const [vdrlPoListLoading, setVdrlPoListLoading] = useState(false)
  const [showVdrlUpload, setShowVdrlUpload] = useState(false)

  // ─── ACTION LOG STATE ─────────────────────────────────────
  const [actionLog, setActionLog] = useState<any[]>([])
  const [logLoading, setLogLoading] = useState(false)

  // ─── DRAWER + WIZARD STATE ────────────────────────────────
  // drawerPoId: ID of PO open in the 400px slide-in drawer.
  // scnWizardState: PO + optional pre-selected line for SCN wizard.
  const [drawerPoId, setDrawerPoId] = useState<number | null>(null)
  const [scnWizardState, setSCNWizardState] = useState<{ poId: number; lineId?: number } | null>(null)

  const col     = dark ? '#f1f5f9' : '#0f172a'
  const bg      = dark ? '#0f172a' : '#f4f7fb'
  const cardBg  = dark ? '#1e293b' : '#fff'
  const bd      = `1px solid ${dark ? '#334155' : '#dde3ed'}`
  const sub     = '#94a3b8'

  // ─── FETCH DATA ───────────────────────────────────────────
  // Stats are whole-project (independent of the register's filters/page).
  useEffect(() => {
    axios.get(`${API}/expediting/${projectId}/stats`).then(r => setStats(r.data)).catch(e => console.error(e))
  }, [projectId])

  // Debounce search so we don't hit the server on every keystroke.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 350)
    return () => clearTimeout(t)
  }, [search])

  // ─── SERVER-SIDE PAGED REGISTER ────────────────────────────
  // All filters (sub-tab, RAG, search, critical, ROS range) + sort run
  // server-side across every locked PO; the grid holds one page. Previously the
  // screen fetched the register with NO page param, so only the first 50 locked
  // POs were ever shown and the filters were page-local. RAG/sub-tab filtering
  // is computed in SQL to match the JS RAG badge logic exactly.
  const fetcher = useCallback(async ({ page, limit, sortCol, sortDir }: { page: number; limit: number; sortCol?: string; sortDir: 'asc' | 'desc' }) => {
    const params: Record<string, string> = { page: String(page), limit: String(limit), sort_dir: sortDir }
    if (sortCol)                params.sort_col      = sortCol
    if (subTab !== 'all')       params.sub_tab       = subTab
    if (ragFilter !== 'all')    params.rag           = ragFilter
    if (debouncedSearch.trim()) params.search        = debouncedSearch.trim()
    if (criticalOnly)           params.critical_only = 'true'
    if (rosFrom)                params.ros_from      = rosFrom
    if (rosTo)                  params.ros_to        = rosTo
    const { data } = await axios.get(`${API}/expediting/${projectId}/register`, { params })
    return { data: (data.data ?? []) as PORow[], total: (data.total ?? 0) as number }
  }, [projectId, subTab, ragFilter, debouncedSearch, criticalOnly, rosFrom, rosTo])

  const {
    data: pos, total, page, setPage, pageSize, loading,
    sortCol, sortDir, toggleSort,
  } = usePagedList<PORow>({
    fetcher, deps: [projectId, subTab, ragFilter, debouncedSearch, criticalOnly, rosFrom, rosTo],
    pageSize: 50, initialSortCol: 'po_number', initialSortDir: 'asc',
  })
  const sortArrow = (k: string) => sortCol === k ? (sortDir === 'asc' ? ' ▲' : ' ▼') : ''

  // ─── VDRL DATA LOAD ───────────────────────────────────────
  // Loads stats and packages when VDRL tab is activated.
  useEffect(() => {
    if (activeTab !== 'vdrl') return
    axios.get(`${API}/expediting/${projectId}/vdrl/stats`).then(r => setVdrlStats(r.data)).catch(() => {})
    axios.get(`${API}/expediting/${projectId}/vdrl/packages`).then(r => {
      setVdrlPackages(r.data)
      if (r.data.length > 0 && !activePackageId) setActivePackageId(r.data[0].id)
    }).catch(() => {})
  }, [activeTab, projectId]) // eslint-disable-line react-hooks/exhaustive-deps

  // ─── VDRL PO LIST LOAD ────────────────────────────────────
  // Loads cross-PO summary when VDRL list view is active.
  useEffect(() => {
    if (activeTab !== 'vdrl' || vdrlView !== 'list') return
    setVdrlPoListLoading(true)
    axios.get(`${API}/expediting/${projectId}/vdrl/po-list`)
      .then(r => setVdrlPoList(r.data))
      .catch(() => {})
      .finally(() => setVdrlPoListLoading(false))
  }, [activeTab, vdrlView, projectId])

  // ─── VDRL DOCS LOAD ───────────────────────────────────────
  // Reloads docs when package, search, or filter changes.
  useEffect(() => {
    if (!activePackageId || activeTab !== 'vdrl') return
    const params: any = { package_id: activePackageId }
    if (vdrlSearch) params.search = vdrlSearch
    if (vdrlStatusFilter !== 'all') params.status = vdrlStatusFilter
    axios.get(`${API}/expediting/${projectId}/vdrl/documents`, { params }).then(r => setVdrlDocs(r.data)).catch(() => {})
  }, [activePackageId, vdrlSearch, vdrlStatusFilter, activeTab, projectId])

  // ─── ACTION LOG LOAD ──────────────────────────────────────
  // Loads cross-PO action notes when action log tab is active.
  useEffect(() => {
    if (activeTab !== 'action-log') return
    setLogLoading(true)
    axios.get(`${API}/expediting/${projectId}/action-log`).then(r => setActionLog(r.data)).catch(() => {}).finally(() => setLogLoading(false))
  }, [activeTab, projectId])

  // Filtering/sort/pagination now happen server-side (see fetcher above);
  // `pos` already holds exactly the current page of the filtered, sorted set.

  // ─── STAT CARDS ───────────────────────────────────────────
  const statCards = [
    { label: 'Total POs',  value: stats.total_pos,  color: col },
    { label: 'Ongoing',    value: stats.ongoing,    color: '#2563eb' },
    { label: 'Breached',   value: stats.breached,   color: '#ef4444' },
    { label: 'At Risk',    value: stats.at_risk,    color: '#f59e0b' },
    { label: 'Complete',   value: stats.complete,   color: '#22c55e' },
  ]

  // ─── VDRL TEMPLATE DOWNLOAD ───────────────────────────────
  // Triggers download of the pre-formatted .xlsx upload template.
  const downloadVdrlTemplate = async () => {
    try {
      const res = await axios.get(`${API}/expediting/${projectId}/vdrl/template`, { responseType: 'blob' })
      const url = URL.createObjectURL(new Blob([res.data]))
      const a = document.createElement('a'); a.href = url; a.download = 'QCO_VDRL_Template.xlsx'
      document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url)
    } catch { /* ignore */ }
  }

  // ─── RENDER ───────────────────────────────────────────────
  return (
    <div style={{ paddingTop: 20, fontFamily: 'IBM Plex Sans, sans-serif', background: bg, minHeight: '100vh' }}>

      {/* Back */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 16, fontSize: 12, color: sub, flexWrap: 'wrap' }}>
        <BackButton onFallback={onBack} dark={dark} />
      </div>

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: col, letterSpacing: '-0.02em' }}>
            Expediting Register
          </h2>
          <div style={{ fontSize: 13, color: sub, marginTop: 3 }}>
            Active PO monitoring — milestone tracking & forecast management · {projectName}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button style={{ fontSize: 12, padding: '6px 14px', borderRadius: 6, border: bd, background: cardBg, color: col, cursor: 'pointer' }}>
            ↓ Export
          </button>
          <HelpButton screenName="Expediting" sections={EXPEDITING_HELP} dark={dark} />
        </div>
      </div>

      {/* Stat cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5,1fr)', gap: 10, marginBottom: 24 }}>
        {statCards.map(({ label, value, color }) => (
          <div key={label} style={{ background: cardBg, border: bd, borderRadius: 8, padding: '14px 18px', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
            <div style={{ fontSize: 24, fontWeight: 700, fontFamily: 'JetBrains Mono, monospace', color }}>{value}</div>
            <div style={{ fontSize: 10, color: sub, marginTop: 3, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</div>
          </div>
        ))}
      </div>

      {/* Main Tabs */}
      <div style={{ display: 'flex', gap: 2, borderBottom: bd, marginBottom: 0 }}>
        {([['pos', 'All POs'], ['vdrl', 'VDRL Register'], ['action-log', 'Action Log']] as [ActiveTab, string][]).map(([tab, label]) => (
          <button key={tab} onClick={() => setTab(tab)} style={{
            padding: '8px 18px', background: 'none', border: 'none', cursor: 'pointer',
            borderBottom: activeTab === tab ? '2px solid #E84E0F' : '2px solid transparent',
            fontSize: 13, fontWeight: activeTab === tab ? 600 : 400,
            color: activeTab === tab ? '#E84E0F' : sub,
            fontFamily: 'inherit', marginBottom: -1,
          }}>{label}</button>
        ))}
      </div>

      {/* ── TAB: All POs ── */}
      {activeTab === 'pos' && (
        <div style={{ background: cardBg, border: bd, borderTop: 'none', borderRadius: '0 0 10px 10px', paddingBottom: 4 }}>

          {/* Sub-tabs */}
          <div style={{ display: 'flex', gap: 2, padding: '10px 16px 0', borderBottom: bd }}>
            {(['all', 'ongoing', 'complete'] as SubTab[]).map(t => (
              <button key={t} onClick={() => setSubTab(t)} style={{
                padding: '5px 14px', fontSize: 12, cursor: 'pointer', border: 'none',
                borderBottom: subTab === t ? '2px solid #E84E0F' : '2px solid transparent',
                background: 'none', color: subTab === t ? '#E84E0F' : sub,
                fontWeight: subTab === t ? 600 : 400, fontFamily: 'inherit', marginBottom: -1,
                textTransform: 'capitalize',
              }}>{t}</button>
            ))}
          </div>

          {/* Toolbar */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 16px', borderBottom: bd, flexWrap: 'wrap' }}>
            <input
              value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Search PO, vendor, material…"
              style={{ flex: 1, minWidth: 180, fontSize: 12, padding: '6px 10px', borderRadius: 6, border: bd, background: dark ? '#0f172a' : '#f8fafc', color: col, fontFamily: 'inherit' }}
            />
            <div style={{ display: 'flex', gap: 4 }}>
              {(['all', 'blue', 'amber', 'red', 'grey', 'complete'] as RAGFilter[]).map(r => (
                <button key={r} onClick={() => setRagFilter(r)} style={{
                  fontSize: 11, padding: '4px 10px', borderRadius: 12, border: 'none', cursor: 'pointer',
                  background: ragFilter === r ? (r === 'all' ? '#E84E0F' : RAG_COLORS[r] || '#64748b') : (dark ? '#0f172a' : '#f1f5f9'),
                  color: ragFilter === r ? '#fff' : sub,
                  fontWeight: ragFilter === r ? 600 : 400,
                }}>{r === 'all' ? 'All' : RAG_LABELS[r] || r}</button>
              ))}
            </div>
            <label style={{ fontSize: 11, color: sub, display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
              <input type="checkbox" checked={criticalOnly} onChange={e => setCriticalOnly(e.target.checked)} />
              Critical only
            </label>
            <input type="date" value={rosFrom} onChange={e => setRosFrom(e.target.value)}
              title="ROS from" style={{ fontSize: 11, padding: '4px 7px', borderRadius: 5, border: bd, background: dark ? '#0f172a' : '#f8fafc', color: col }} />
            <input type="date" value={rosTo} onChange={e => setRosTo(e.target.value)}
              title="ROS to" style={{ fontSize: 11, padding: '4px 7px', borderRadius: 5, border: bd, background: dark ? '#0f172a' : '#f8fafc', color: col }} />
            <span style={{ fontSize: 11, color: sub }}>{total} PO{total !== 1 ? 's' : ''}</span>
          </div>

          {/* Table */}
          {loading ? (
            <div style={{ textAlign: 'center', color: sub, padding: '48px 0', fontSize: 13 }}>Loading…</div>
          ) : pos.length === 0 ? (
            <div style={{ textAlign: 'center', color: sub, padding: '48px 0', fontSize: 13 }}>No POs match the filter.</div>
          ) : (
            <div style={{ overflowX: 'auto', overflowY: 'auto', maxHeight: 'calc(100vh - 320px)' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead style={{ position: 'sticky', top: 0, zIndex: 1, backgroundColor: dark ? '#162032' : '#f8fafc' }}>
                  <tr style={{ borderBottom: bd }}>
                    {([['★'], [''], ['PO Ref', 'po_number'], ['Vendor / Group', 'vendor'], ['Material'], ['Owner / Expeditor'], ['Milestones'], ['ROS', 'ros_date'], ['Status', 'status'], ['']] as [string, string?][]).map(([h, key], i) => (
                      <th key={i} onClick={key ? () => toggleSort(key) : undefined}
                        style={{ padding: '8px 12px', textAlign: 'left', fontSize: 10, fontWeight: 600, color: sub, textTransform: 'uppercase', letterSpacing: '0.06em', whiteSpace: 'nowrap', cursor: key ? 'pointer' : 'default', userSelect: 'none' }}>
                        {h}{key ? sortArrow(key) : ''}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {pos.map(po => {
                    // BUG-2 FIX: use RAG-based status pill, not procurement status
                    const ragPill = RAG_STATUS_PILLS[po.rag] || RAG_STATUS_PILLS['grey']
                    return (
                      <tr key={po.id}
                        style={{ borderBottom: `1px solid ${dark ? '#1e293b' : '#f1f5f9'}`, cursor: 'pointer', opacity: po.rag === 'complete' ? 0.65 : 1 }}
                        onClick={() => setDrawerPoId(po.id)}
                      >
                        {/* BUG-3 FIX: ★ star column */}
                        <td style={{ padding: '10px 6px', width: 28, textAlign: 'center' }}
                            onClick={e => e.stopPropagation()}>
                          <span title={po.is_critical_path ? 'Critical path' : 'Not critical path'}
                            style={{ fontSize: 16, color: po.is_critical_path ? '#E84E0F' : '#c4cedf', cursor: 'pointer', userSelect: 'none' }}>
                            {po.is_critical_path ? '★' : '☆'}
                          </span>
                        </td>
                        {/* RAG stripe */}
                        <td style={{ padding: '10px 0 10px 4px', width: 6 }}>
                          <div style={{ width: 3, height: 32, borderRadius: 2, background: RAG_COLORS[po.rag] || '#94a3b8' }} />
                        </td>
                        {/* PO Ref */}
                        <td style={{ padding: '10px 12px', whiteSpace: 'nowrap' }}
                            onClick={e => { e.stopPropagation(); onNavigateToPODetail(po.id) }}>
                          <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 12, color: '#E84E0F', fontWeight: 600, cursor: 'pointer' }}>
                            {po.po_number}
                          </div>
                          {po.po_name && <div style={{ fontSize: 11, color: sub }}>{po.po_name}</div>}
                        </td>
                        {/* Vendor / Group */}
                        <td style={{ padding: '10px 12px', maxWidth: 140 }}>
                          <div style={{ color: col, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{po.vendor_display || '—'}</div>
                          {po.group_category && <div style={{ fontSize: 10, color: sub, textTransform: 'capitalize' }}>{po.group_category}</div>}
                        </td>
                        {/* Material */}
                        <td style={{ padding: '10px 12px', maxWidth: 200 }}>
                          <div style={{ color: col, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{po.material_description || '—'}</div>
                        </td>
                        {/* Owner / Expeditor — BUG-4 FIX: show "— Unassigned" for missing expeditor */}
                        <td style={{ padding: '10px 12px', whiteSpace: 'nowrap' }}>
                          <div style={{ color: col }}>{po.owner_name || '—'}</div>
                          <div style={{ fontSize: 10, color: po.expeditor_name ? sub : '#c4cedf', fontStyle: po.expeditor_name ? 'normal' : 'italic' }}>
                            {po.expeditor_name || '— Unassigned'}
                          </div>
                        </td>
                        {/* Milestones */}
                        <td style={{ padding: '10px 12px' }}>
                          <MilestoneTimeline milestones={po.milestones} size="sm" dark={dark} />
                        </td>
                        {/* ROS */}
                        <td style={{ padding: '10px 12px', whiteSpace: 'nowrap', fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: sub }}>{fmt(po.ros_date)}</td>
                        {/* Status — BUG-2 FIX: RAG-based not procurement status */}
                        <td style={{ padding: '10px 12px', whiteSpace: 'nowrap' }}>
                          <span style={{ fontSize: 11, padding: '3px 8px', borderRadius: 10, background: ragPill.bg, color: ragPill.color, fontWeight: 600 }}>
                            {ragPill.label}
                          </span>
                        </td>
                        {/* Navigate — opens drawer; PO ref cell navigates to full screen */}
                        <td style={{ padding: '10px 12px' }}>
                          <button
                            onClick={e => { e.stopPropagation(); setDrawerPoId(po.id) }}
                            style={{ fontSize: 11, padding: '4px 10px', borderRadius: 5, border: bd, background: 'transparent', color: col, cursor: 'pointer', whiteSpace: 'nowrap' }}>
                            View →
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}

          <Pager page={page} total={total} pageSize={pageSize} dark={dark} onPageChange={setPage} />

          {/* ── MILESTONE LEGEND ─────────────────────────────── */}
          <MilestoneLegend dark={dark} />
        </div>
      )}

      {/* ── TAB: VDRL Register ── */}
      {activeTab === 'vdrl' && (
        <div style={{ background: cardBg, border: bd, borderTop: 'none', borderRadius: '0 0 10px 10px', padding: 20 }}>

          {/* ── LIST VIEW ── */}
          {vdrlView === 'list' && (() => {
            const secBtn = {fontSize:12,padding:'6px 14px',borderRadius:6,border:bd,background:cardBg,color:col,cursor:'pointer' as const,fontFamily:'inherit'}
            return (
              <div>
                {/* Header row */}
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:16}}>
                  <div style={{fontSize:16,fontWeight:600,color:col}}>VDRL Register</div>
                  <div style={{display:'flex',gap:8,alignItems:'center'}}>
                    <HelpButton screenName="VDRL Register" sections={VDRL_REGISTER_HELP} dark={dark} />
                    <button onClick={downloadVdrlTemplate} style={secBtn}>↓ Template</button>
                    <button onClick={()=>setShowVdrlUpload(true)} style={{...secBtn,color:'#2563eb',borderColor:'#2563eb'}}>↑ Upload VDRL</button>
                  </div>
                </div>

                {/* KPI strip — aggregated across all packages */}
                <div style={{display:'grid',gridTemplateColumns:'repeat(5,1fr)',gap:10,marginBottom:20}}>
                  {[
                    {label:'TOTAL PACKAGES', value:vdrlPoList.reduce((s,p)=>s+(parseInt(String(p.package_count))||0),0), color:col},
                    {label:'TOTAL DOCS',     value:vdrlPoList.reduce((s,p)=>s+(parseInt(String(p.total_docs))||0),0),    color:col},
                    {label:'SUBMITTED',      value:vdrlPoList.reduce((s,p)=>s+(parseInt(String(p.submitted_count))||0),0), color:'#22c55e'},
                    {label:'OVERDUE',        value:vdrlPoList.reduce((s,p)=>s+(parseInt(String(p.overdue_count))||0),0),  color:'#ef4444'},
                    {label:'ABF CLEARED',    value:vdrlStats?.abf_cleared_count||0,                     color:'#f59e0b'},
                  ].map(({label,value,color})=>(
                    <div key={label} style={{background:cardBg,border:bd,borderRadius:8,padding:'12px 16px'}}>
                      <div style={{fontSize:22,fontWeight:700,fontFamily:'JetBrains Mono, monospace',color}}>{value}</div>
                      <div style={{fontSize:10,color:sub,textTransform:'uppercase',letterSpacing:'0.06em',marginTop:3}}>{label}</div>
                    </div>
                  ))}
                </div>

                {/* PO list table */}
                {vdrlPoListLoading ? (
                  <div style={{textAlign:'center',padding:40,color:sub}}>Loading…</div>
                ) : vdrlPoList.length === 0 ? (
                  <div style={{border:`2px dashed ${dark?'#334155':'#dde3ed'}`,borderRadius:10,padding:'48px 32px',textAlign:'center'}}>
                    <div style={{fontSize:13,color:sub,marginBottom:8}}>No VDRL packages yet.</div>
                    <div style={{fontSize:12,color:sub,marginBottom:16}}>VDRL document requirements are linked to approved POs. Add a package to get started.</div>
                    <button onClick={()=>setShowNewPackage(true)} style={{padding:'7px 16px',borderRadius:6,border:'none',background:'#2563eb',color:'#fff',fontSize:12,fontWeight:600,cursor:'pointer',fontFamily:'inherit'}}>+ New package</button>
                  </div>
                ) : (
                  <div style={{background:cardBg,border:bd,borderRadius:10,overflow:'hidden'}}>
                    <table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}>
                      <thead>
                        <tr style={{background:dark?'#0f172a':'#f8fafc',borderBottom:bd}}>
                          {['PO REF','PO NAME','VENDOR','PACKAGES','TOTAL DOCS','SUBMITTED','OVERDUE','PROGRESS',''].map(h=>(
                            <th key={h} style={{padding:'8px 12px',textAlign:'left',fontSize:10,fontWeight:600,color:sub,textTransform:'uppercase',letterSpacing:'0.06em',whiteSpace:'nowrap'}}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {vdrlPoList.map(po=>{
                          const total=po.total_docs||0; const submitted=po.submitted_count||0
                          const pct=total>0?Math.round(submitted/total*100):0
                          return (
                            <tr key={po.id} style={{borderBottom:bd,cursor:'pointer'}}
                              onMouseEnter={e=>{(e.currentTarget as HTMLTableRowElement).style.background=dark?'#162032':'#f0f4ff'}}
                              onMouseLeave={e=>{(e.currentTarget as HTMLTableRowElement).style.background=''}}>
                              <td style={{padding:'10px 12px',fontFamily:'JetBrains Mono, monospace',fontSize:12,fontWeight:700,color:'#2563eb',whiteSpace:'nowrap'}}>{po.po_number}</td>
                              <td style={{padding:'10px 12px',color:col,maxWidth:160,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{po.po_name||'—'}</td>
                              <td style={{padding:'10px 12px',color:sub,maxWidth:120,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{po.vendor_name||'—'}</td>
                              <td style={{padding:'10px 12px',textAlign:'center'}}>
                                <span style={{fontSize:10,padding:'2px 8px',borderRadius:9999,background:'rgba(37,99,235,0.1)',color:'#1d4ed8',fontWeight:600}}>{po.package_count} pkg</span>
                              </td>
                              <td style={{padding:'10px 12px',textAlign:'center',fontFamily:'JetBrains Mono, monospace',fontSize:12,color:col}}>{total}</td>
                              <td style={{padding:'10px 12px',textAlign:'center',fontFamily:'JetBrains Mono, monospace',fontSize:12,color:submitted>0?'#22c55e':sub}}>{submitted}</td>
                              <td style={{padding:'10px 12px',textAlign:'center',fontFamily:'JetBrains Mono, monospace',fontSize:12,color:po.overdue_count>0?'#ef4444':sub}}>{po.overdue_count||0}</td>
                              <td style={{padding:'10px 12px',minWidth:100}}>
                                <div style={{display:'flex',alignItems:'center',gap:8}}>
                                  <div style={{flex:1,height:4,borderRadius:2,background:dark?'#334155':'#e2e8f0'}}>
                                    <div style={{height:'100%',borderRadius:2,background:'#22c55e',width:`${pct}%`}} />
                                  </div>
                                  <span style={{fontSize:10,color:sub,whiteSpace:'nowrap',fontFamily:'JetBrains Mono, monospace'}}>{pct}%</span>
                                </div>
                              </td>
                              <td style={{padding:'10px 12px'}}>
                                <button
                                  onClick={e=>{e.stopPropagation();setSelectedVdrlPoId(po.id);const pkgs=vdrlPackages||[];const pkg=pkgs.find((p:any)=>p.po_id===po.id)||pkgs[0];if(pkg)setActivePackageId(pkg.id);setVdrlView('package')}}
                                  style={{fontSize:11,padding:'4px 10px',borderRadius:5,border:bd,background:'none',color:'#2563eb',cursor:'pointer',fontFamily:'inherit',whiteSpace:'nowrap'}}>
                                  View →
                                </button>
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                )}

                {/* New Package modal (accessible from empty state) */}
                {showNewPackage && (
                  <VDRLNewPackageModal dark={dark} projectId={projectId} onClose={()=>setShowNewPackage(false)}
                    onCreated={pkg=>{setVdrlPackages(ps=>[pkg,...ps]);setActivePackageId(pkg.id);setVdrlView('package')}} />
                )}

                {/* Upload modal */}
                {showVdrlUpload && (
                  <VDRLUploadModal dark={dark} projectId={projectId} onClose={()=>setShowVdrlUpload(false)}
                    onImported={()=>{
                      axios.get(`${API}/expediting/${projectId}/vdrl/po-list`).then(r=>setVdrlPoList(r.data)).catch(()=>{})
                      axios.get(`${API}/expediting/${projectId}/vdrl/stats`).then(r=>setVdrlStats(r.data)).catch(()=>{})
                    }} />
                )}
              </div>
            )
          })()}

          {/* ── PACKAGE VIEW ── */}
          {vdrlView === 'package' && (() => {
            const selPo = vdrlPoList.find(p=>p.id===selectedVdrlPoId)
            const activePkg = vdrlPackages.find(p=>p.id===activePackageId)
            return (
              <div>
                {/* Back link */}
                <button onClick={()=>setVdrlView('list')} style={{background:'none',border:'none',color:'#2563eb',fontSize:12,cursor:'pointer',fontFamily:'inherit',padding:0,marginBottom:14,display:'flex',alignItems:'center',gap:4}}>
                  ← Back to VDRL Register
                </button>

                {/* PO context bar */}
                {vdrlPackages.length === 0 ? (
                  <div style={{background:'rgba(245,158,11,0.08)',border:'1px solid rgba(245,158,11,0.3)',borderRadius:8,padding:'10px 16px',marginBottom:12,fontSize:13,color:'#b45309'}}>
                    No VDRL packages configured. Click <strong>+ New package</strong> to begin.
                    <button onClick={()=>setShowNewPackage(true)} style={{marginLeft:10,fontSize:11,padding:'4px 10px',borderRadius:5,border:'none',background:'#2563eb',color:'#fff',cursor:'pointer'}}>+ New package</button>
                  </div>
                ) : (
                  <div style={{background:dark?'#162032':'#f8fafc',border:bd,borderRadius:8,padding:'12px 16px',marginBottom:12,display:'flex',justifyContent:'space-between',alignItems:'flex-start'}}>
                    {/* Left: PO info */}
                    <div>
                      {selPo ? (
                        <>
                          <div style={{fontFamily:'JetBrains Mono, monospace',fontSize:15,fontWeight:700,color:'#0f172a'}}>{selPo.po_number}</div>
                          <div style={{fontSize:13,color:col,marginTop:2}}>{selPo.po_name||'—'}</div>
                          <div style={{fontSize:12,color:sub,marginTop:1}}>{selPo.vendor_name||'—'}</div>
                        </>
                      ) : (
                        <div style={{fontSize:13,color:sub}}>Select a PO from the register</div>
                      )}
                    </div>
                    {/* Right: Package + actions */}
                    <div style={{textAlign:'right'}}>
                      <div style={{fontSize:13,fontWeight:600,color:col,marginBottom:6}}>{activePkg?.name||'—'}</div>
                      <div style={{display:'flex',gap:8,justifyContent:'flex-end'}}>
                        <button onClick={()=>setShowSwitchPackage(true)} style={{fontSize:11,padding:'4px 10px',borderRadius:5,border:bd,background:'none',color:col,cursor:'pointer',fontFamily:'inherit'}}>⇄ Switch</button>
                        <button onClick={()=>setShowNewPackage(true)} style={{fontSize:11,padding:'4px 10px',borderRadius:5,border:'none',background:'#2563eb',color:'#fff',cursor:'pointer',fontFamily:'inherit'}}>+ New package</button>
                      </div>
                    </div>
                  </div>
                )}

                {/* Toolbar + table */}
                <div style={{display:'flex',gap:8,marginBottom:12,flexWrap:'wrap'}}>
                  <input value={vdrlSearch} onChange={e=>setVdrlSearch(e.target.value)} placeholder="Search doc no, title..."
                    style={{height:32,padding:'0 10px',borderRadius:6,border:bd,background:dark?'#0f172a':'#f8fafc',color:col,fontSize:12,fontFamily:'inherit',flex:'1 1 200px'}} />
                  <select value={vdrlStatusFilter} onChange={e=>setVdrlStatusFilter(e.target.value)}
                    style={{height:32,padding:'0 8px',borderRadius:6,border:bd,background:dark?'#0f172a':'#f8fafc',color:col,fontSize:12}}>
                    <option value="all">All statuses</option>
                    <option value="approved">Approved</option>
                    <option value="under_review">Under review</option>
                    <option value="overdue">Overdue</option>
                    <option value="not_submitted">Not submitted</option>
                    <option value="Resubmit">Resubmit</option>
                  </select>
                  <button onClick={()=>setShowAddDoc(true)} disabled={!activePackageId}
                    style={{padding:'4px 12px',borderRadius:5,border:'none',background:'#22c55e',color:'#fff',fontSize:12,cursor:'pointer',opacity:activePackageId?1:0.5,fontFamily:'inherit'}}>
                    + Add document
                  </button>
                </div>

                <VDRLDocTable docs={vdrlDocs} dark={dark} onRowClick={setSelectedDoc} />

                {/* Modals */}
                {showNewPackage && (
                  <VDRLNewPackageModal dark={dark} projectId={projectId} onClose={()=>setShowNewPackage(false)}
                    onCreated={pkg=>{setVdrlPackages(ps=>[pkg,...ps]);setActivePackageId(pkg.id)}} />
                )}
                {showSwitchPackage && (
                  <VDRLSwitchPackageModal dark={dark} packages={vdrlPackages} activeId={activePackageId}
                    onSelect={setActivePackageId} onClose={()=>setShowSwitchPackage(false)} />
                )}
                {showAddDoc && activePackageId && (
                  <VDRLAddDocModal dark={dark} projectId={projectId} packageId={activePackageId}
                    onClose={()=>setShowAddDoc(false)}
                    onAdded={()=>{
                      const params: any = { package_id: activePackageId }
                      if (vdrlSearch) params.search = vdrlSearch
                      if (vdrlStatusFilter !== 'all') params.status = vdrlStatusFilter
                      axios.get(`${API}/expediting/${projectId}/vdrl/documents`, { params }).then(r=>setVdrlDocs(r.data)).catch(()=>{})
                      axios.get(`${API}/expediting/${projectId}/vdrl/stats`).then(r=>setVdrlStats(r.data)).catch(()=>{})
                    }} />
                )}
                {/* Doc detail panel */}
                {selectedDoc && (
                  <div onClick={()=>setSelectedDoc(null)} style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.4)',zIndex:9000,display:'flex',alignItems:'center',justifyContent:'center',fontFamily:'IBM Plex Sans, sans-serif'}}>
                    <div onClick={e=>e.stopPropagation()} style={{background:cardBg,border:bd,borderRadius:10,padding:24,width:500,boxShadow:'0 16px 48px rgba(0,0,0,0.4)'}}>
                      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:16}}>
                        <span style={{fontWeight:700,fontSize:14,color:col}}>{selectedDoc.title}</span>
                        <button onClick={()=>setSelectedDoc(null)} style={{background:'none',border:'none',fontSize:18,color:sub,cursor:'pointer'}}>×</button>
                      </div>
                      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10,fontSize:12}}>
                        {[
                          ['Doc Number', selectedDoc.doc_number||'—'],
                          ['Type', selectedDoc.doc_type||'—'],
                          ['Revision', selectedDoc.revision||'—'],
                          ['Status', selectedDoc.status||'—'],
                          ['Required By', fmtDateShort(selectedDoc.required_date)],
                          ['Promised By', fmtDateShort(selectedDoc.promised_date)],
                          ['Submitted', fmtDateShort(selectedDoc.submitted_date)],
                          ['Package', selectedDoc.package_name||'—'],
                        ].map(([l,v])=>(
                          <div key={l}>
                            <div style={{fontSize:9,color:sub,textTransform:'uppercase',marginBottom:2}}>{l}</div>
                            <div style={{color:col,fontWeight:500}}>{v}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )
          })()}
        </div>
      )}

      {/* ── TAB: Action Log ── */}
      {activeTab === 'action-log' && (
        <div style={{ background: cardBg, border: bd, borderTop: 'none', borderRadius: '0 0 10px 10px', padding: 24 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: col, marginBottom: 16 }}>Action Notes — All POs</div>
          {logLoading ? (
            <div style={{textAlign:'center',padding:40,color:sub}}>Loading…</div>
          ) : actionLog.length === 0 ? (
            <div style={{textAlign:'center',padding:40,color:sub,fontStyle:'italic'}}>No action notes logged yet.</div>
          ) : actionLog.map(n => (
            <div key={n.id} style={{display:'flex',gap:12,padding:'12px 0',borderBottom:`1px solid ${dark?'#1e293b':'#f1f5f9'}`}}>
              <div style={{width:32,height:32,borderRadius:'50%',background:'#e2e8f0',display:'flex',alignItems:'center',justifyContent:'center',fontSize:12,fontWeight:700,flexShrink:0,color:'#475569'}}>
                {(n.created_by_name||'?')[0].toUpperCase()}
              </div>
              <div style={{flex:1,minWidth:0}}>
                <div style={{display:'flex',gap:8,alignItems:'center',marginBottom:4,flexWrap:'wrap'}}>
                  <span style={{fontWeight:600,fontSize:13,color:col}}>{n.created_by_name||'Unknown'}</span>
                  <span style={{fontSize:11,color:sub}}>{n.created_by_role||''}</span>
                  <span style={{fontSize:11,color:sub}}>on</span>
                  <button onClick={()=>onNavigateToPODetail(n.po_id)}
                    style={{background:'none',border:'none',color:'#2563eb',fontSize:11,cursor:'pointer',fontFamily:'JetBrains Mono, monospace',padding:0}}>
                    {n.po_number}
                  </button>
                  <span style={{fontSize:11,color:sub,marginLeft:'auto'}}>{new Date(n.created_at).toLocaleDateString('en-AU',{day:'2-digit',month:'short',year:'numeric'})}</span>
                </div>
                <div style={{fontSize:13,color:col}}>{n.note_text}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── PO DRAWER ── */}
      <ExpPODrawer
        poId={drawerPoId}
        projectId={projectId}
        dark={dark}
        onClose={() => setDrawerPoId(null)}
        onOpenFullScreen={(id) => { setDrawerPoId(null); onNavigateToPODetail(id) }}
        onCreateSCN={(poId, lineId) => { setDrawerPoId(null); setSCNWizardState({ poId, lineId }) }}
      />

      {/* ── CREATE SCN WIZARD ── */}
      {scnWizardState && (
        <CreateSCNWizard
          poId={scnWizardState.poId}
          projectId={projectId}
          preSelectedLineId={scnWizardState.lineId}
          onClose={() => setSCNWizardState(null)}
          onCreated={(_scn) => { setSCNWizardState(null) }}
          onToast={(msg, type) => addToast(type, msg)}
        />
      )}
    </div>
  )
}

// ─── EXPORTED COMPONENT (wraps with ToastProvider) ───────────────────────────
// ToastProvider must be an ancestor of any component calling useToast().
export const ExpeditingScreen = (props: ExpeditingScreenProps) => (
  <ToastProvider>
    <ExpeditingScreenInner {...props} />
  </ToastProvider>
)
