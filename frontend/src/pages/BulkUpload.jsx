import React, {useState} from 'react';
import {api} from '../lib/api';
import {Upload, Download} from 'lucide-react';

function downloadCsv(name, content){
  const blob=new Blob([content],{type:'text/csv;charset=utf-8'});
  const url=URL.createObjectURL(blob); const a=document.createElement('a');
  a.href=url; a.download=name; a.click(); URL.revokeObjectURL(url);
}

export function BulkUploadExpenses(){
  const [file,setFile]=useState(null),[message,setMessage]=useState(''),[busy,setBusy]=useState(false);
  const submit=async e=>{e.preventDefault();if(!file)return;setBusy(true);setMessage('');try{const fd=new FormData();fd.append('file',file);const r=await api('/bulk-upload/expenses',{method:'POST',body:fd});setMessage(`Imported ${r.imported} expense(s).${r.skipped?` Skipped ${r.skipped}.`:''}`)}catch(err){setMessage(err.message)}finally{setBusy(false)}};
  return <section><h2>Bulk Upload Expenses</h2><div className="card"><p>Upload a CSV using the predefined format. Share values use <code>survivor:shareType:amount</code> separated by <code>|</code>; amount is omitted for average/remaining shares.</p><button type="button" onClick={()=>downloadCsv('expenses-template.csv','date,category,item,other_item,quantity,unit,total_cost,expense_type,shares\n2026-09-30,Food,Breakfast,,1,piece,100,cash,John Doe:fixed:100\n')}><Download/> Download CSV template</button></div><form className="card inline" onSubmit={submit}><input type="file" accept=".csv,text/csv" required onChange={e=>setFile(e.target.files?.[0]||null)}/><button className="primary" disabled={busy}><Upload/> {busy?'Uploading…':'Upload CSV'}</button></form>{message&&<div className="notice">{message}</div>}</section>
}

export function BulkUploadCategoriesItems(){
  const [file,setFile]=useState(null),[message,setMessage]=useState(''),[busy,setBusy]=useState(false);
  const submit=async e=>{e.preventDefault();if(!file)return;setBusy(true);setMessage('');try{const fd=new FormData();fd.append('file',file);const r=await api('/bulk-upload/categories-items',{method:'POST',body:fd});setMessage(`Imported ${r.categories} categor${r.categories===1?'y':'ies'} and ${r.items} item(s).`)}catch(err){setMessage(err.message)}finally{setBusy(false)}};
  return <section><h2>Bulk Upload Categories & Items</h2><div className="card"><p>Each CSV column represents one category. The first row is the category name and following rows are its items.</p><button type="button" onClick={()=>downloadCsv('categories-items-template.csv','Food,Medicines,Medical\nBreakfast,Paracetamol,Doctor visiting\nDinner,Vitamin tablets,Medical Test\n')}><Download/> Download CSV template</button></div><form className="card inline" onSubmit={submit}><input type="file" accept=".csv,text/csv" required onChange={e=>setFile(e.target.files?.[0]||null)}/><button className="primary" disabled={busy}><Upload/> {busy?'Uploading…':'Upload CSV'}</button></form>{message&&<div className="notice">{message}</div>}</section>
}
