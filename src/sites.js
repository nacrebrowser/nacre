(function () {
  'use strict';
  const api=window.nacre, root=document.querySelector('#sites'), status=document.querySelector('#status');
  let messages={}, data=null, language='', generation=0;
  const drafts=new Map(), pending=new Set();let draftTarget='';
  const t=key=>messages[key]||key;
  const element=(tag,className,text)=>{const node=document.createElement(tag);if(className)node.className=className;if(text!==undefined)node.textContent=text;return node;};
  function options(select, choices) {for(const[value,key]of choices){const o=element('option','',t(key));o.value=value;select.append(o);}}
  function render() {
    if(!data)return;root.replaceChildren();
    document.querySelectorAll('[data-i18n]').forEach(node=>{const key=node.dataset.i18n;if(messages[key])node.textContent=messages[key];});
    const current=data.current;
    const target=current?[current.tabId,current.origin,current.documentEpoch].join('|'):'';
    if(target!==draftTarget){drafts.clear();draftTarget=target;}
    if(current){
      const card=element('article','site');card.id='current-site-controls';card.dataset.tabId=String(current.tabId);card.dataset.origin=current.origin;
      card.append(element('h2','',current.origin),element('p','note',data.private?t('siteControls.privateNote'):t('siteControls.scopeNote')));
      for(const permission of current.permissions){
        const row=element('div','permission');row.dataset.permission=permission.key;
        const title=element('label','',t('siteControls.permission.'+permission.key.replace(/-/g,'')));
        const mode=element('select');mode.id='permission-'+permission.key;title.htmlFor=mode.id;options(mode,[['deny','siteControls.deny'],['ask','siteControls.ask'],['allow','siteControls.allow']]);mode.value=permission.mode;
        const scope=element('select');scope.id=mode.id+'-scope';scope.setAttribute('aria-label',t('siteControls.duration'));options(scope,[['temporary','siteControls.temporary'],...(data.private?[]:[['persistent','siteControls.persistent']])]);scope.value=permission.temporary||data.private?'temporary':'persistent';
        const key=target+'|'+permission.key,draft=drafts.get(key);
        if(draft){mode.value=draft.mode;scope.value=draft.scope;}
        const button=element('button','',t('siteControls.apply'));button.id='site-permission-apply-'+permission.key;
        mode.disabled=scope.disabled=button.disabled=pending.has(key);
        const edit=()=>drafts.set(key,{mode:mode.value,scope:scope.value});
        mode.addEventListener('change',edit);scope.addEventListener('change',edit);
        button.addEventListener('click',async()=>{if(pending.has(key))return;pending.add(key);mode.disabled=scope.disabled=button.disabled=true;try{const accepted=await api.applySitePermission({tabId:current.tabId,origin:current.origin,documentEpoch:current.documentEpoch,permission:permission.key,mode:mode.value,scope:scope.value});if(accepted)drafts.delete(key);status.textContent=t(accepted?'siteControls.saved':'siteControls.stale');}catch{status.textContent=t('siteControls.failed');}finally{pending.delete(key);await refresh(false);}});
        row.append(title,mode,scope,button);card.append(row);
      }
      const cookieRow=element('div','permission');cookieRow.dataset.permission='cookieHeaders';
      const cookieLabel=element('label','',t('settings.cookiePolicy'));cookieLabel.htmlFor='site-cookie-policy';
      const cookiePolicy=element('select');cookiePolicy.id='site-cookie-policy';options(cookiePolicy,[['default','siteControls.useGlobal'],['allow','settings.cookiesAllow'],['block-third-party','settings.cookiesBlockThirdParty'],['block-all','settings.cookiesBlockAll']]);cookiePolicy.value=current.cookies.override;
      const cookieScope=element('select');cookieScope.id='site-cookie-scope';cookieScope.setAttribute('aria-label',t('siteControls.duration'));options(cookieScope,[['temporary','siteControls.temporary'],...(data.private?[]:[['persistent','siteControls.persistent']])]);cookieScope.value=current.cookies.temporary||data.private?'temporary':'persistent';
      const cookieKey=target+'|cookieHeaders',cookieDraft=drafts.get(cookieKey);
      if(cookieDraft){cookiePolicy.value=cookieDraft.policy;cookieScope.value=cookieDraft.scope;}
      const cookieButton=element('button','',t('siteControls.apply'));cookieButton.id='site-cookie-apply';
      cookiePolicy.disabled=cookieScope.disabled=cookieButton.disabled=pending.has(cookieKey);
      const editCookies=()=>drafts.set(cookieKey,{policy:cookiePolicy.value,scope:cookieScope.value});
      cookieButton.addEventListener('click',async()=>{if(pending.has(cookieKey))return;pending.add(cookieKey);cookiePolicy.disabled=cookieScope.disabled=cookieButton.disabled=true;try{const accepted=await api.applySiteCookies({tabId:current.tabId,origin:current.origin,documentEpoch:current.documentEpoch,policy:cookiePolicy.value,scope:cookieScope.value});if(accepted)drafts.delete(cookieKey);status.textContent=t(accepted?'siteControls.saved':'siteControls.stale');}catch{status.textContent=t('siteControls.failed');}finally{pending.delete(cookieKey);await refresh(false);}});
      cookiePolicy.addEventListener('change',editCookies);cookieScope.addEventListener('change',editCookies);cookieRow.append(cookieLabel,cookiePolicy,cookieScope,cookieButton);card.append(cookieRow);
      const note=element('p','note',t('siteControls.cookieNote'));note.id='site-cookie-limit';card.append(note);root.append(card);
    }else root.append(element('p','empty',t('siteControls.noCurrent')));
    if(!data.private&&data.sites.length){
      root.append(element('h2','',t('siteControls.savedSites')));
      for(const site of data.sites){
        const card=element('article','site'),head=element('div','site-head'),title=element('h3','',site.host),reset=element('button','',t('siteControls.resetSite'));
        reset.addEventListener('click',()=>api.resetSitePermissions(site.host));head.append(title,reset);card.append(head);
        for(const permission of site.permissions){const row=element('label','permission'),select=element('select');options(select,[['deny','siteControls.deny'],['ask','siteControls.ask'],['allow','siteControls.allow']]);select.value=permission.mode;select.addEventListener('change',()=>api.setSitePermission(site.host,permission.key,select.value));row.append(element('span','',t('siteControls.permission.'+permission.key.replace(/-/g,''))),select);card.append(row);}root.append(card);
      }
    }
  }
  async function refresh(clearStatus=true){const seq=++generation;try{const next=await api.getSitePermissions();if(seq!==generation)return;data=next;if(clearStatus)status.textContent='';render();}catch{if(seq===generation)status.textContent=t('siteControls.failed');}}
  document.querySelector('#refresh').addEventListener('click',()=>refresh());
  document.querySelector('#reset-all').addEventListener('click',()=>api.resetSitePermissions('*'));
  api.onState(async state=>{if(language!==state.settings.language){language=state.settings.language;messages=await api.getMessages(language);}refresh(false);});
  Promise.all([api.getLanguage().then(value=>api.getMessages(value)),api.getSitePermissions()]).then(([catalog,initial])=>{messages=catalog;data=initial;render();}).catch(()=>{status.textContent=t('siteControls.failed');});
})();
