import React, { useEffect, useMemo, useState } from "react";
import { BookOpen, Search, X } from "lucide-react";
import { api } from "../lib/api";
import "./dietChart.css";

function RecipeDetails({ recipe, onClose }) {
  if (!recipe) return null;
  return <div className="diet-modal-backdrop" onMouseDown={(e)=>e.target===e.currentTarget&&onClose()}><section className="diet-modal"><header><h2>{recipe.name}</h2><button className="icon-button" onClick={onClose} aria-label="Close"><X size={18}/></button></header><p className="diet-muted">{recipe.category} · {recipe.region} · Prep {recipe.prepMinutes||0} min · Cook {recipe.cookMinutes||0} min · Serves {recipe.servings||2}</p><h3>Ingredients</h3><div className="diet-ingredients">{(recipe.ingredients||[]).map((x,i)=><div key={i}><span>{x.name}</span><strong>{[x.quantity,x.unit].filter(Boolean).join(" ")||"As needed"}</strong></div>)}</div><h3>Preparation</h3><ol className="diet-steps">{(recipe.steps||[]).map((x,i)=><li key={i}><strong>{x.section||`Step ${i+1}`}</strong><span className="diet-time">{x.minutes||0} min</span><p>{x.text}</p></li>)}</ol>{recipe.notes&&<><h3>Notes</h3><p>{recipe.notes}</p></>}</section></div>;
}

export default function RecipeMaster(){
 const [recipes,setRecipes]=useState([]),[loading,setLoading]=useState(true),[error,setError]=useState(""),[query,setQuery]=useState(""),[viewer,setViewer]=useState(null);
 useEffect(()=>{let active=true;api("/recipes").then(r=>{if(active)setRecipes(Array.isArray(r)?r:[])}).catch(e=>{if(active)setError(e.message||"Unable to load recipes")}).finally(()=>{if(active)setLoading(false)});return()=>{active=false}},[]);
 const filtered=useMemo(()=>recipes.filter(r=>[r.name,r.category,r.region,...(r.ingredients||[]).map(i=>i.name)].join(" ").toLowerCase().includes(query.toLowerCase())),[recipes,query]);
 return <main className="diet-page"><div className="diet-page-heading"><div><h1>Recipe Master</h1><p>Browse the built-in recipe catalogue. To change recipes, update <code>backend/src/data/recipes.json</code> and redeploy the project.</p></div></div>{error&&<div className="diet-error">{error}</div>}<label className="diet-search"><Search size={17}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search recipe, ingredient, category or region…"/></label>
 {loading?<p>Loading recipes…</p>:<div className="diet-recipe-list">{filtered.map(r=><article className="diet-recipe-row" key={r.id}><div className="diet-recipe-main"><strong>{r.name}</strong><span>{r.category} · {r.region} · {r.ingredients?.length||0} ingredients · {Number(r.prepMinutes||0)+Number(r.cookMinutes||0)} min</span></div><div className="diet-actions"><button className="icon-button" title="View recipe" aria-label={`View ${r.name}`} onClick={()=>setViewer(r)}><BookOpen size={18}/></button></div></article>)}{!filtered.length&&<div className="diet-empty">{query?"No recipes match your search.":"No recipes found in the static catalogue."}</div>}</div>}
 <RecipeDetails recipe={viewer} onClose={()=>setViewer(null)}/></main>;
}
