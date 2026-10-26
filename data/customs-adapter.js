/* Customs Affairs faculty schedule adapter.
 * Safety rule: only explicitly verified records are rendered. Week 12–18 Oct 2026 = Б,
 * 19–25 Oct = А; subsequent weeks alternate.
 */
(function(root){
  "use strict";
  let draft=null;
  const GROUPS=[
    "Тс00/О-2601",
    "Тс00/О-2602",
    "Тс00/О-2603",
    "Тс00/О-2604",
    "Тс00/О-2605",
    "Тс00/О-2606",
    "Тс00/О-2501",
    "Тс00/О-2502",
    "Тс00/О-2503",
    "Тс00/О-2504",
    "Тс00/О-2505",
    "Тс00/О-2506",
    "Тс00/О-2507",
    "Тс00/О-2508",
    "Тс00/О-2401",
    "Тс00/О-2402",
    "Тс00/О-2403",
    "Тс00/О-2404",
    "Тс00/О-2405",
    "Тс01/О-2301",
    "Тс01/О-2302",
    "Тс06/О-2303",
    "Тс05/О-2304",
    "Тс09/О-2305",
    "Тс01/О-2201",
    "Тс01/О-2202",
    "Тс06/О-2203",
    "Тс05/О-2204",
    "Тс09/О-2205",
    "Тс00/О-2406",
    "Тс00/О-2407",
    "Тс00/О-2408",
    "Тс00/О-2409",
    "Тс02/О-2306",
    "Тс02/О-2307",
    "Тс02/О-2308",
    "Тс07/О-2309",
    "Тс08/О-2310",
    "Тс02/О-2206",
    "Тс02/О-2207",
    "Тс02/О-2208",
    "Тс07/О-2209",
    "Тс08/О-2210"
  ];
  const ANCHOR_MONDAY=new Date(2026,9,12,12);
  function dayOnly(value){
    if(typeof value==="string" && /^\d{4}-\d{2}-\d{2}$/.test(value)){
      const [y,m,d]=value.split("-").map(Number);
      return new Date(y,m-1,d,12);
    }
    const d=value instanceof Date?value:new Date(value);
    return new Date(d.getFullYear(),d.getMonth(),d.getDate(),12);
  }
  function stamp(d){return String(d.getDate()).padStart(2,"0")+"."+String(d.getMonth()+1).padStart(2,"0");}
  function parity(d){
    const monday=dayOnly(d);
    monday.setDate(monday.getDate()-((monday.getDay()+6)%7));
    const weeks=Math.round((monday-ANCHOR_MONDAY)/(7*86400000));
    return ((weeks%2)+2)%2===0?"Б":"А";
  }
  function getLessonsForDate(group,value){
    if(!draft || !["VERIFIED","PRELIMINARY","CONNECTED_TO_SUPABASE"].includes(draft._status) || !Array.isArray(draft.lessons)) return [];
    if(!GROUPS.includes(group)) return [];
    const d=dayOnly(value);
    if(Number.isNaN(d.getTime()) || d.getFullYear()!==2026 ||
       d<new Date(2026,8,1,12) || d>new Date(2026,11,31,12)) return [];
    const day=(d.getDay()+6)%7, dm=stamp(d), week=parity(d);
    let rows=draft.lessons.filter(x=>x.group===group && Number(x.day)===day &&
      (!(x.week || (x.parity === "нечётная неделя" ? "Б" : x.parity === "чётная неделя" ? "А" : "")) || (x.week || (x.parity === "нечётная неделя" ? "Б" : x.parity === "чётная неделя" ? "А" : ""))===week) &&
      (!Array.isArray(x.dates) || x.dates.includes(dm)) &&
      (!Array.isArray(x.excluded_dates) || !x.excluded_dates.includes(dm)) &&
      (!x.dates_from || d>=dateBoundary(x.dates_from,d.getFullYear(),false)) &&
      (!x.dates_until || d<=dateBoundary(x.dates_until,d.getFullYear(),true)));
    const overrides=new Set(rows.filter(x=>Array.isArray(x.dates)&&x.dates.includes(dm)).map(x=>x.start+"|"+x.end));
    rows=rows.filter(x=>(Array.isArray(x.dates)&&x.dates.includes(dm))||!overrides.has(x.start+"|"+x.end));
    const seen=new Set();
    return rows.filter(x=>{
      const key=[x.start,x.end,x.title,x.type,x.teacher,x.room].join("|");
      if(seen.has(key))return false; seen.add(key); return true;
    }).map(x=>({
      start:x.start,end:x.end,title:x.title,type:x.type||"Занятие",
      room:x.room||"Уточняется накануне",teacher:x.teacher||"",
      dates:Array.isArray(x.dates)?x.dates.join(", "):"",
      color:(x.type||"").includes("Физкультура")?"green":"blue",note:x.note||""
    })).sort((a,b)=>a.start.localeCompare(b.start));
  }
  function dateBoundary(value,year,end){
    const [d,m]=String(value).split(".").map(Number);
    return new Date(year,m-1,d, end?23:0,end?59:0,end?59:0);
  }
  root.CustomsSchedule={
    groups:GROUPS.slice(),
    setDraft(data){
      if(!data || !["VERIFIED","PRELIMINARY","CONNECTED_TO_SUPABASE"].includes(data._status) || !Array.isArray(data.lessons) || data.lessons.length===0)
        throw new Error("Расписание таможенного дела не прошло проверку источника");
      for(const row of data.lessons){
        if(!GROUPS.includes(row.group) || !Number.isInteger(Number(row.day)) ||
           !/^\d{2}:\d{2}$/.test(row.start||"") || !/^\d{2}:\d{2}$/.test(row.end||"") ||
           !row.title) throw new Error("В расписании таможенного дела найдена неполная или неизвестная запись");
      }
      draft=data;
    },
    getLessonsForDate,
    get loaded(){return !!draft && ["VERIFIED","PRELIMINARY","CONNECTED_TO_SUPABASE"].includes(draft._status) && draft.lessons.length>0;}
  };
  if(typeof module!=="undefined"&&module.exports)module.exports=root.CustomsSchedule;
})(typeof window!=="undefined"?window:globalThis);
