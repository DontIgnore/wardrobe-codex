const $ = id => document.getElementById(id);
let selected = null, jobs = [], category = 'Все вещи', lastSnapshot = '';
const labels = {queued:'В очереди',analyzing:'Распознаём вещи',generating:'Создаём каталожные снимки',done:'Образ разобран',partial:'Часть вещей требует повтора',failed:'Не удалось обработать'};
function node(tag, text, className) { const el = document.createElement(tag); if(text !== undefined) el.textContent=text; if(className)el.className=className; return el; }
function notify(text, error=false){$('notice').textContent=text;$('notice').className=error?'error':'';}
function select(file){
  if(!file)return;
  if(!['image/jpeg','image/png'].includes(file.type))return notify('Выберите фотографию JPG или PNG.',true);
  if(file.size>15*1024*1024)return notify('Фотография должна быть меньше 15 МБ.',true);
  if(selected)URL.revokeObjectURL($('preview').src);
  selected=file;$('preview').src=URL.createObjectURL(file);$('preview-wrap').hidden=false;$('drop').hidden=true;$('upload').disabled=false;notify('');
}
function clear(){if(selected)URL.revokeObjectURL($('preview').src);selected=null;$('photo').value='';$('preview-wrap').hidden=true;$('drop').hidden=false;$('upload').disabled=true;}
$('photo').addEventListener('change',e=>select(e.target.files[0]));$('clear').onclick=clear;
for(const type of ['dragenter','dragover'])$('drop').addEventListener(type,e=>{e.preventDefault();$('drop').classList.add('drag');});
for(const type of ['dragleave','drop'])$('drop').addEventListener(type,e=>{e.preventDefault();$('drop').classList.remove('drag');if(type==='drop')select(e.dataTransfer.files[0]);});
async function post(url,payload){const res=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});const value=await res.json();if(!res.ok)throw Error(value.error||'Ошибка сервера');return value;}
$('upload').onclick=async()=>{
  if(!selected)return;$('upload').disabled=true;notify('Загружаем фотографию…');
  try{const image=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=reject;reader.readAsDataURL(selected);});await post('/api/jobs',{image});clear();notify('Образ добавлен. Вещи появятся здесь автоматически.');await refresh();}
  catch(error){notify(error.message||'Не удалось загрузить фото.',true);$('upload').disabled=false;}
};
async function retry(jobId,itemId,button){button.disabled=true;try{await post('/api/retry',{jobId,itemId});await refresh();}catch(error){notify(error.message,true);button.disabled=false;}}
async function reprocess(jobId,button){button.disabled=true;try{await post('/api/reprocess',{jobId});notify('Создаём новый разбор с крупными планами. Предыдущие результаты сохранены.');await refresh();}catch(error){notify(error.message,true);button.disabled=false;}}
function product(item,job){
  const card=node('article',undefined,'product'),frame=node('div',undefined,'product-image');
  if(item.image){const link=node('a');link.href=item.image;link.target='_blank';link.rel='noopener';link.setAttribute('aria-label','Открыть: '+item.name);const img=node('img');img.src=item.image;img.alt=item.name;img.loading='lazy';link.append(img);frame.append(link);}
  else{const placeholder=node('div',undefined,'placeholder');if(item.status==='generating')placeholder.append(node('div',undefined,'spinner'));placeholder.append(node('span',item.status==='failed'?'Не получилось создать снимок':item.status==='generating'?'Создаём снимок…':'Ожидает генерации'));frame.append(placeholder);}
  card.append(frame,node('h3',item.name));const meta=node('div',undefined,'product-meta');meta.append(node('span',item.category));
  if(item.image){const download=node('a','Скачать','download');download.href=item.image;download.download=item.name+'.png';meta.append(download);}card.append(meta);
  if(item.crop){const crop=node('a','Крупный план','crop-link');crop.href=item.crop;crop.target='_blank';crop.rel='noopener';crop.setAttribute('aria-label','Крупный план: '+item.name);card.append(crop);}
  if(item.status==='failed'){card.append(node('p',item.error,'error'));const button=node('button','Повторить','retry');button.disabled=['queued','analyzing','generating'].includes(job.status);button.onclick=()=>retry(job.id,item.id,button);card.append(button);}return card;
}
function render(){
  const items=jobs.flatMap(j=>j.items);$('count').textContent=items.filter(i=>i.status==='ready').length;
  const categories=['Все вещи',...new Set(items.map(i=>i.category))];if(!categories.includes(category))category='Все вещи';
  $('filters').replaceChildren(...categories.map(c=>{const b=node('button',c,'filter'+(category===c?' active':''));b.setAttribute('aria-pressed',category===c);b.onclick=()=>{category=c;render();};return b;}));
  $('empty').hidden=jobs.length>0;$('jobs').replaceChildren();
  for(const job of jobs){const visible=job.items.filter(i=>category==='Все вещи'||i.category===category);if(!visible.length&&category!=='Все вещи')continue;
    const section=node('section',undefined,'job'),head=node('div',undefined,'job-head'),source=node('a');source.href=job.source;source.target='_blank';source.rel='noopener';source.setAttribute('aria-label','Открыть исходную фотографию');const img=node('img');img.src=job.source;img.alt='Исходный образ';img.className='source';source.append(img);const text=node('div');text.append(node('div',labels[job.status]||job.status,'job-title'),node('div',new Date(job.created*1000).toLocaleDateString('ru-RU',{day:'numeric',month:'long'})+' · '+job.items.filter(i=>i.status==='ready').length+' / '+job.items.length+' вещей'+(job.pipeline==='crop-parallel-v2'?' · Крупные планы':''),'job-meta'));head.append(source,text);section.append(head);
    if(!['queued','analyzing','generating'].includes(job.status)){const button=node('button','Разобрать заново с крупными планами','text-button');button.onclick=()=>reprocess(job.id,button);section.append(button);}
    if(job.error)section.append(node('p',job.error,'error'));
    if(job.status==='failed'){const button=node('button','Повторить обработку','retry');button.onclick=()=>retry(job.id,null,button);section.append(button);}
    if(!job.items.length){section.append(node('p',job.status==='done'?'На фотографии не найдены вещи. Попробуйте другой снимок.':job.status==='failed'?'Можно повторить обработку или добавить другое фото.':'Сначала определим одежду и аксессуары на фотографии.','job-message'));}
    const grid=node('div',undefined,'grid');grid.append(...visible.map(i=>product(i,job)));section.append(grid);$('jobs').append(section);
  }
}
async function refresh(){try{const response=await fetch('/api/jobs');if(!response.ok)throw Error();const next=await response.json();const snapshot=JSON.stringify(next);jobs=next;if(lastSnapshot!==snapshot){render();lastSnapshot=snapshot;}$('connection').textContent=jobs.some(j=>['queued','analyzing','generating'].includes(j.status))?'Обработка идёт':'Сохранено на компьютере';}catch{$('connection').textContent='Нет связи с сервером';}}
refresh();setInterval(refresh,2500);
