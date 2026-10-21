(function(root){
"use strict";
let draft=null;
const GROUPS=["Ю601/О-2501","Ю602/О-2502","Ю603/О-2503","Ю604/О-2504"];
const ANCHOR=new Date(2026,9,12);
function dayOnly(value){
 if(typeof value==="string"&&/^\d{4}-\d{2}-\d{2}$/.test(value)){const [y,m,d]=value.split("-").map(Number);return new Date(y,m-1,d,12);}
 const x=value instanceof Date?value:new Date(value);return new Date(x.getFullYear(),x.getMonth(),x.getDate(),12);
}
function dm(d){return String(d.getDate()).padStart(2,"0")+"."+String(d.getMonth()+1).padStart(2,"0");}
function parity(d){
 const monday=new Date(d.getFullYear(),d.getMonth(),d.getDate(),12);monday.setDate(monday.getDate()-((monday.getDay()+6)%7));
 const anchor=new Date(ANCHOR);anchor.setDate(anchor.getDate()-((anchor.getDay()+6)%7));
 const n=Math.round((monday-anchor)/604800000);
 return ((n%2)+2)%2===0?"нечётная неделя":"чётная неделя";
}
function getLessonsForDate(group,value){
 if(!draft||!GROUPS.includes(group))return[];
 const d=dayOnly(value);
 if(Number.isNaN(d.getTime())||d.getFullYear()!==2026||d<new Date(2026,8,1,12)||d>new Date(2026,11,31,12))return[];
 const stamp=dm(d),day=(d.getDay()+6)%7,p=parity(d);
 let rows=draft.lessons.filter(x=>x.group===group&&Number(x.day)===day&&(!x.parity||x.parity===p)&&(!Array.isArray(x.dates)||x.dates.includes(stamp))&&(!Array.isArray(x.excluded_dates)||!x.excluded_dates.includes(stamp))&&(!x.dates_from||(()=>{const [dd,mm]=x.dates_from.split(".").map(Number);return d>=new Date(d.getFullYear(),mm-1,dd,12);})())&&(!x.dates_until||(()=>{const [dd,mm]=x.dates_until.split(".").map(Number);return d<=new Date(d.getFullYear(),mm-1,dd,12);})()));
 const overrides=rows.filter(x=>Array.isArray(x.dates)&&x.dates.includes(stamp));
 const overrideSlots=new Set(overrides.map(x=>x.start+"|"+x.end));
 rows=rows.filter(x=>!(x.parity!==undefined&&overrideSlots.has(x.start+"|"+x.end)));
 const courseHourSlots=new Set(rows.filter(x=>x.title==="Курсовой час").map(x=>x.start+"|"+x.end));
 rows=rows.filter(x=>x.title==="Курсовой час"||!courseHourSlots.has(x.start+"|"+x.end));
 const seen=new Set();
 return rows.filter(x=>{const k=[x.start,x.end,x.title,x.type,x.teacher,x.room].join("|");if(seen.has(k))return false;seen.add(k);return true;})
 .map(x=>({start:x.start,end:x.end,title:x.title,type:x.type||"Занятие",room:x.room||"Уточняется накануне",teacher:x.teacher||"",dates:Array.isArray(x.dates)?x.dates.join(", "):"",color:(x.type||"").includes("Физкультура")?"green":"blue",note:x.note||""}))
 .sort((a,b)=>a.start.localeCompare(b.start));
}
root.Course2Schedule={groups:GROUPS.slice(),setDraft(data){if(!data||!Array.isArray(data.lessons))throw Error("Некорректные данные 2-го курса");draft=data;},getLessonsForDate,get loaded(){return !!draft&&Array.isArray(draft.lessons);}};
if(typeof module!=="undefined"&&module.exports)module.exports=root.Course2Schedule;
})(typeof window!=="undefined"?window:globalThis);
