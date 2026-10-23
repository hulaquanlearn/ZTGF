const icon=name=>`<img src="/icons/${name}.svg" alt="" aria-hidden="true">`;
export function mountLearningHome({app}){
  const link=(href,label,name)=>`<a href="${href}">${icon(name)}<span>${label}</span></a>`;
  app.innerHTML=`<section class="learning-workspace" aria-label="学习"><h1 class="sr-only">学习</h1><div class="learning-primary"><h2>${icon('book')}<span>词汇</span></h2><a class="button" id="homeStart" href="/vocabulary">开始学习</a></div><nav class="learning-skills" aria-label="听说读写">${[['listening','听力','headphones'],['reading','阅读','book'],['writing','写作','pencil'],['speaking','口语','message-circle']].map(([page,label,name])=>link('/ielts/'+page,label,name)).join('')}</nav><nav class="learning-resources" aria-label="资料与复习">${link('/banks','题库','files')}${link('/corpus','语料','bookmark')}${link('/review','复习','history')}</nav></section>`;
}
