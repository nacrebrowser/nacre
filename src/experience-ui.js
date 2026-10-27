(function () {
  'use strict';
  const api = window.nacre, chromeUI = window.NacreChrome;
  let state = null, messages = {}, language = '', localeSequence = 0;
  const $ = selector => document.querySelector(selector);
  const t = key => messages[key] || key;
  function node(tag, className, text) { const e = document.createElement(tag); if (className) e.className = className; if (text !== undefined) e.textContent = text; return e; }
  function button(id, key, action, icon) {
    const e = node('button', 'experience-button'); e.type = 'button'; e.id = id; e.dataset.experienceLabel = key;
    if (icon) { const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.setAttribute('aria-hidden', 'true'); const use = document.createElementNS(svg.namespaceURI, 'use'); use.setAttribute('href', '#i-' + icon); svg.append(use); e.append(svg); }
    e.append(node('span', 'experience-label', t(key)));
    e.addEventListener('click', () => Promise.resolve().then(action).catch(showError)); return e;
  }
  function showError(error) {
    const message = api.localizeText(error?.message) || t('experience.failed');
    status.textContent = message;
    chromeUI.showToast?.(message);
  }
  function workspaceName(item) { return item.private ? t('experience.private') : item.id === 'personal' && item.name === 'Personal' ? t('experience.personal') : item.id === 'work' && item.name === 'Work' ? t('experience.work') : item.name; }
  const bar = node('nav', 'workspace-bar'); bar.setAttribute('aria-label', 'Workspaces');
  const select = node('select'); select.id = 'workspace-select'; select.setAttribute('aria-label', 'Workspace');
  select.addEventListener('change', () => api.workspace({action:'select',id:select.value}).catch(showError));
  const status = node('span', 'experience-status'); status.id = 'experience-status'; status.setAttribute('role','status');
  $('#workspace-switcher-host').append(select);
  bar.append(
    button('workspace-manage','experience.spaces', manageWorkspaces, 'spaces'),
    button('vertical-tabs-toggle','experience.vertical', () => api.savePreferences({verticalTabs:!state.settings.verticalTabs}), 'sidebar'),
    button('split-view-open','experience.split', chooseSplit, 'split'),
    button('commands-open','commands.title', () => palette.open(), 'command'), status);
  $('#browser-menu-experience').append(bar);
  const sidebar = node('aside','workspace-sidebar'); sidebar.id = 'workspace-sidebar'; sidebar.hidden = true; document.body.append(sidebar);
  const splitBar = node('div','split-controls'); splitBar.id = 'split-controls'; splitBar.hidden = true;
  const firstPane = button('split-first','experience.leftPane', () => api.activateTab(state.splitView.ids[0]));
  const secondPane = button('split-second','experience.rightPane', () => api.activateTab(state.splitView.ids[1]));
  const ratio = node('input'); ratio.type = 'range'; ratio.id = 'split-ratio'; ratio.min = '25'; ratio.max = '75'; ratio.value = '50';
  ratio.addEventListener('input', () => api.splitView({action:'ratio',ratio:Number(ratio.value)/100}).catch(showError));
  splitBar.append(firstPane, ratio, secondPane, button('split-close','experience.closeSplit', () => api.splitView({action:'close'})));
  $('#chrome').append(splitBar);
  const shortcuts = $('#home-custom-shortcuts');
  let draggedShortcut = -1, shortcutsKey = '', messagesVersion = 0, wallpaperId = '', wallpaperSequence = 0;
  $('#browser-menu-home').append(button('home-customize','experience.customize', customizeHome, 'sliders'));

  const palette = window.NacreCommands.create({ api, getState:()=>state, t,
    onOpen:()=>chromeUI.beginOverlay(), onClose:()=>chromeUI.endOverlay(),
    actions:[
      {id:'spaces',label:()=>t('experience.spaces'),run:manageWorkspaces},
      {id:'vertical',label:()=>t('experience.vertical'),run:()=>api.savePreferences({verticalTabs:!state.settings.verticalTabs})},
      {id:'split',label:()=>t('experience.split'),run:chooseSplit},
      {id:'home',label:()=>t('experience.customize'),run:customizeHome},
      {id:'pin-home',label:()=>t('home.pinCurrent'),run:()=>chromeUI.pinCurrentPage().then(added=>{if(added)chromeUI.showToast(t('toast.shortcutAdded'));})}
    ] });
  api.onCommands(()=>palette.open().catch(showError));
  window.addEventListener('keydown', event => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase()==='k') { event.preventDefault(); palette.open().catch(showError); }
  });
  function field(form, key, control) { const label = node('label','experience-field'); label.append(node('span','',t(key)),control); form.append(label); return control; }
  async function modal(key, build) {
    if (!state || document.querySelector('.experience-dialog[open]')) return;
    const d = node('dialog','experience-dialog'); const form = node('form'); form.method='dialog';
    form.append(node('h2','',t(key))); const content = node('div','experience-form'); form.append(content);
    const close = button('experience-dialog-close','commands.close',()=>d.close());
    form.append(close); d.append(form); document.body.append(d);
    d.addEventListener('close',()=>{d.remove(); chromeUI.endOverlay();});
    try { build(content,d); await chromeUI.beginOverlay(); d.showModal(); }
    catch(error) {d.remove(); await chromeUI.endOverlay(); throw error;}
  }
  function manageWorkspaces() {
    return modal('experience.spaces', (form,d)=>{
      form.append(node('p','experience-note',t('experience.isolationNote')));
      const current = state.workspaces.items.find(item=>item.id===state.workspaces.activeId);
      const name = node('input'); name.id='workspace-name';name.maxLength=64;name.value=current && !current.private ? current.name : '';
      field(form,'experience.name',name);
      const actions=node('div','experience-actions');
      actions.append(button('workspace-create','experience.create',async()=>{if(!name.value.trim())return;await api.workspace({action:'create',name:name.value});d.close();}));
      const rename=button('workspace-rename','experience.rename',async()=>{await api.workspace({action:'rename',id:current.id,name:name.value});d.close();});
      const remove=button('workspace-remove','experience.remove',async()=>{await api.workspace({action:'remove',id:current.id});d.close();});
      rename.disabled=!current||current.private;remove.disabled=rename.disabled||state.workspaces.items.filter(x=>!x.private).length<=1;
      actions.append(rename,remove);form.append(actions,node('p','experience-note',t('experience.removeNote')));
      const destination=node('select');destination.id='workspace-move-target';
      for(const item of state.workspaces.items.filter(x=>!x.private)){const o=node('option','',workspaceName(item));o.value=item.id;destination.append(o);}
      field(form,'experience.moveTarget',destination);
      const move=button('workspace-move','experience.moveTab',async()=>{await api.workspace({action:'move',id:destination.value,tabId:state.activeId});d.close();});
      move.disabled=!!state.active?.private;form.append(move);
    });
  }
  function chooseSplit() {
    return modal('experience.split', (form,d)=>{
      const eligible=state.tabs.filter(tab=>tab.id!==state.activeId&&tab.workspaceId===state.active.workspaceId&&tab.private===state.active.private&&!tab.internal&&/^https?:\/\//.test(tab.url));
      if(!state.active||state.active.internal||!/^https?:\/\//.test(state.active.url)||!eligible.length){form.append(node('p','experience-note',t('experience.splitNeedTwo')));return;}
      const target=node('select');target.id='split-target';
      for(const tab of eligible){const o=node('option','',tab.title+' · '+tab.url);o.value=String(tab.id);target.append(o);}
      field(form,'experience.secondPage',target);
      form.append(button('split-confirm','experience.openSplit',async()=>{const accepted=await api.splitView({action:'open',peerId:Number(target.value)});if(accepted)d.close();else showError({message:t('experience.splitNeedTwo')});}));
    });
  }
  function customizeHome() {
    return modal('experience.customize',(form,d)=>{
      const prefs=state.settings.home||{};
      const background=node('select');background.id='home-background';
      for(const value of ['default','paper','slate','forest']){const o=node('option','',t('experience.background.'+value));o.value=value;background.append(o);}background.value=prefs.background||'default';
      field(form,'experience.background',background);
      const engine=node('select');engine.id='home-engine';
      for(const value of ['duckduckgo','qwant','startpage','brave','ecosia']){const o=node('option','',value==='duckduckgo'?'DuckDuckGo':value[0].toUpperCase()+value.slice(1));o.value=value;engine.append(o);}
      if(state.settings.searchEngine==='custom'){const o=node('option','',t('engines.custom'));o.value='custom';engine.append(o);}engine.value=state.settings.searchEngine;
      field(form,'experience.engine',engine);
      const show=node('input');show.type='checkbox';show.id='home-show-shortcuts';show.checked=prefs.showShortcuts!==false;field(form,'experience.showShortcuts',show);
      form.append(node('p','experience-note',t('home.shortcutsHint')),node('p','experience-note',t('experience.localHome')));
      form.append(button('home-customize-save','experience.save',()=>{
        api.savePreferences({home:{background:background.value,showShortcuts:show.checked},searchEngine:engine.value});d.close();
      }),button('home-customize-reset','experience.reset',()=>{api.savePreferences({home:{}});d.close();}));
    });
  }
  // Add, rename or remove one home shortcut. index < 0 adds a new one.
  function editShortcut(index) {
    const item=(state.settings.home?.shortcuts||[])[index];
    return modal(item?'home.editShortcut':'home.addShortcut',(form,d)=>{
      const title=node('input');title.id='home-shortcut-title';title.maxLength=48;title.value=item?.title||'';
      const address=node('input');address.id='home-shortcut-url';address.maxLength=2048;address.value=item?.url||'';address.spellcheck=false;address.placeholder='https://';
      field(form,'home.shortcutName',title);field(form,'home.shortcutUrl',address);
      const error=node('p','experience-error');error.setAttribute('role','alert');form.append(error);
      const actions=node('div','experience-actions');
      actions.append(button('home-shortcut-save','experience.save',async()=>{
        const saved=await api.homeShortcuts(item?{action:'update',index,title:title.value,url:address.value}:{action:'add',title:title.value,url:address.value});
        if(saved)d.close();else error.textContent=t((state.settings.home?.shortcuts||[]).length>=20&&!item?'home.shortcutsFull':'experience.invalidShortcut');
      }));
      if(item)actions.append(button('home-shortcut-remove','experience.remove',async()=>{await api.homeShortcuts({action:'remove',index});d.close();}));
      form.append(actions);
      (item?title:address).autofocus=true;
    });
  }
  function shortcutTile(item,index){
    const holder=node('div','home-shortcut-item');holder.draggable=true;holder.dataset.index=String(index);
    const tile=chromeUI.homeTile(item.url,item.title);tile.draggable=true;
    const more=node('button','home-shortcut-more');more.type='button';more.title=t('home.editShortcut');more.setAttribute('aria-label',t('home.editShortcut')+' · '+item.title);
    const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('aria-hidden','true');const use=document.createElementNS(svg.namespaceURI,'use');use.setAttribute('href','#i-more');svg.append(use);more.append(svg);
    more.addEventListener('click',event=>{event.stopPropagation();editShortcut(index).catch(showError);});
    holder.addEventListener('contextmenu',event=>{event.preventDefault();editShortcut(index).catch(showError);});
    holder.addEventListener('dragstart',event=>{draggedShortcut=index;holder.classList.add('is-dragging');event.dataTransfer.effectAllowed='move';event.dataTransfer.setData('text/plain',item.url);});
    holder.addEventListener('dragend',()=>{draggedShortcut=-1;for(const e of shortcuts.querySelectorAll('.is-dragging,.is-drop-target'))e.classList.remove('is-dragging','is-drop-target');});
    holder.addEventListener('dragover',event=>{if(draggedShortcut<0||draggedShortcut===index)return;event.preventDefault();event.dataTransfer.dropEffect='move';holder.classList.add('is-drop-target');});
    holder.addEventListener('dragleave',()=>holder.classList.remove('is-drop-target'));
    holder.addEventListener('drop',event=>{event.preventDefault();const from=draggedShortcut;draggedShortcut=-1;if(from>=0&&from!==index)api.homeShortcuts({action:'move',index:from,to:index}).catch(showError);});
    // Keyboard reordering: Alt+Left / Alt+Right on a focused tile.
    tile.addEventListener('keydown',event=>{if(!event.altKey||!['ArrowLeft','ArrowRight'].includes(event.key))return;event.preventDefault();api.homeShortcuts({action:'move',index,to:index+(event.key==='ArrowLeft'?-1:1)}).then(()=>requestAnimationFrame(()=>shortcuts.querySelector('[data-index="'+Math.max(0,index+(event.key==='ArrowLeft'?-1:1))+'"] .home-tile')?.focus())).catch(showError);});
    holder.append(tile,more);return holder;
  }
  // State updates are frequent (every blocked request); the grid is rebuilt
  // only when what it shows changes, so hover, clicks and drags are not cut.
  function renderShortcuts(force){
    const prefs=state.settings.home||{};const list=prefs.shortcuts||[];
    const key=JSON.stringify([list,prefs.showShortcuts,!!state.active?.private,language,messagesVersion]);
    if(!force&&key===shortcutsKey)return;shortcutsKey=key;
    shortcuts.hidden=prefs.showShortcuts===false;shortcuts.replaceChildren();
    list.forEach((item,index)=>shortcuts.append(shortcutTile(item,index)));
    if(list.length<20&&!state.active?.private){
      const add=node('button','home-tile home-shortcut home-shortcut-add');add.type='button';add.id='home-shortcut-add';
      const icon=node('span','home-tile-icon');const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('aria-hidden','true');const use=document.createElementNS(svg.namespaceURI,'use');use.setAttribute('href','#i-plus');svg.append(use);icon.append(svg);
      add.append(icon,node('span','home-tile-label',t('home.addShort')));add.title=t('home.addShortcut');add.setAttribute('aria-label',t('home.addShortcut'));
      add.addEventListener('click',()=>editShortcut(-1).catch(showError));shortcuts.append(add);
    }
  }
  // The custom home background arrives as a JPEG data: URL (see main.cjs).
  function renderWallpaper(){
    const id=state.settings.homeWallpaper||'';if(id===wallpaperId)return;wallpaperId=id;
    const home=$('#home'),seq=++wallpaperSequence;
    if(!id){home.classList.remove('has-wallpaper');home.style.removeProperty('--home-wallpaper');return;}
    api.wallpaper('get').then(url=>{if(seq!==wallpaperSequence)return;const valid=typeof url==='string'&&/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(url);home.classList.toggle('has-wallpaper',valid);if(valid)home.style.setProperty('--home-wallpaper','url("'+url+'")');else home.style.removeProperty('--home-wallpaper');}).catch(()=>{wallpaperId='';});
  }
  window.addEventListener('nacre:site-icons',()=>{if(state&&draggedShortcut<0)renderShortcuts(true);});
  function render() {
    if(!state?.workspaces)return;
    for(const e of document.querySelectorAll('[data-experience-label]')){const label=e.querySelector('.experience-label');if(label)label.textContent=t(e.dataset.experienceLabel);else e.textContent=t(e.dataset.experienceLabel);}
    bar.setAttribute('aria-label',t('experience.spaces'));select.setAttribute('aria-label',t('experience.spaces'));ratio.setAttribute('aria-label',t('experience.balance'));
    select.replaceChildren();for(const item of state.workspaces.items){const o=node('option','',workspaceName(item)+' ('+(state.workspaces.counts[item.id]||0)+')');o.value=item.id;select.append(o);}select.value=state.workspaces.activeId;
    const vertical=state.settings.verticalTabs===true;document.body.classList.toggle('vertical-tabs',vertical);sidebar.hidden=!vertical;
    const list=$('#tab-list');if(vertical&&list.parentElement!==sidebar)sidebar.append(list);else if(!vertical&&list.parentElement===sidebar)$('.tab-row').prepend(list);
    $('#vertical-tabs-toggle').setAttribute('aria-pressed',String(vertical));
    const ids=state.splitView?.ids||[];splitBar.hidden=ids.length!==2;
    if(ids.length===2){for(const [i,b]of[firstPane,secondPane].entries()){const tab=state.tabs.find(x=>x.id===ids[i]);b.textContent=tab?.url||'';b.title=tab?.url||'';b.setAttribute('aria-pressed',String(tab?.id===state.activeId));}if(document.activeElement!==ratio)ratio.value=String(state.splitView.ratio*100);}
    const prefs=state.settings.home||{};$('#home').dataset.background=prefs.background||'default';
    if(draggedShortcut<0)renderShortcuts();renderWallpaper();
    palette.refresh();chromeUI.refreshLayout();
  }
  api.onState(next=>{
    state=next;
    if(language!==next.settings.language){language=next.settings.language;const seq=++localeSequence;api.getMessages(language).then(map=>{if(seq===localeSequence){messages=map;messagesVersion++;bar.dataset.language=language;render();}}).catch(showError);}
    render();
  });
})();
