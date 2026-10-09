// All passages, questions and explanations below were written for this project.
// IELTS-style describes a practice format, not an official paper or band score.
const sourceName = '智题工坊原创阅读练习 v6';

function bank(seedKey, title, track, category, materialTitle, materialText, questions) {
  return {
    seedKey, title, track, module:'reading', category,
    sourceName, source:'项目原创学习材料', license:'项目原创内容',
    difficulty:track === 'english' ? 'beginner' : 'intermediate',
    questions:questions.map((question, index) => ({
      options:[], blanks:[], points:1, reviewStatus:'approved',
      ...question, groupId:seedKey, materialTitle, materialText,
      generatedBy:'project-original', sourceLocator:`${materialTitle} · 第 ${index + 1} 题`,
      language:'en'
    }))
  };
}

export const seedStudyBanks = [
  bank('english-reading-library-v1', '基础英语 · 图书馆周末计划', 'english', '生活阅读',
    'A Saturday at the Library',
    `Mina usually studies at home, but her street is noisy on Saturday mornings. This week, she decides to visit the library. It opens at nine, and the journey takes twenty minutes by bus. She leaves home at half past eight.

Mina brings her notebook and a bottle of water. She wants to borrow a travel book and finish her English homework. At eleven, she meets her friend Leo in the cafe next to the library. They have lunch there and discuss a trip to the coast. Mina needs to return home before two because her cousin is coming to visit.`, [
      {type:'choice', question:'Why does Mina choose to study at the library this Saturday?', options:['Her street is noisy in the morning.','She has lost her notebook.','The library is next to her home.','Her cousin works there.'], answer:0, explanation:'第一段说明她家所在的街道周六早晨很吵，因此她决定去图书馆。'},
      {type:'fill', question:'Complete the sentence with ONE word from the passage: Mina plans to borrow a _____ book.', blanks:[{answers:['travel']}], answer:[['travel']], explanation:'第二段直接写道：She wants to borrow a travel book。'},
      {type:'choice', question:'Where does Mina meet Leo?', options:['At the bus stop.','In the cafe next to the library.','At the coast.','At Mina\'s home.'], answer:1, explanation:'第二段写明，她十一点在图书馆旁边的咖啡馆与 Leo 见面。'}
    ]),
  bank('english-reading-garden-v1', '基础英语 · 社区花园', 'english', '生活阅读',
    'The Community Garden',
    `A small piece of land behind Oak Street was empty for years. Last spring, some neighbors turned it into a community garden. They grow tomatoes, beans and flowers. Anyone who lives nearby can join, and no experience is necessary.

The group meets every Sunday at ten in the morning. New members should bring gloves, but the group provides tools. In dry weather, volunteers take turns watering the plants during the week. They share the vegetables with each other. Some also take extra vegetables to the local food center. The garden is now a place to learn new skills and meet people.`, [
      {type:'choice', question:'Who can join the garden group?', options:['Only people with gardening experience.','Only residents of Oak Street.','Anyone who lives nearby.','Only people who own tools.'], answer:2, explanation:'第一段明确说明住在附近的人都可以加入，而且不需要经验。'},
      {type:'fill', question:'Complete the sentence with ONE word from the passage: New members should bring _____.', blanks:[{answers:['gloves']}], answer:[['gloves']], explanation:'第二段说明新成员需要带手套，工具由小组提供。'},
      {type:'multiple', question:'Choose TWO things the passage says members do with the vegetables.', options:['Sell them to a restaurant.','Share them with one another.','Send all of them to a school.','Take some extra vegetables to a local food center.'], answer:[1,3], explanation:'文中提到成员相互分享蔬菜，有些成员还把多余的蔬菜送到当地食品援助中心。必须同时选中这两项。'}
    ]),
  bank('ielts-reading-cooling-v1', '雅思阅读入门 · 城市降温试验', 'ielts', '阅读方法',
    'Testing a Cooler Street',
    `A town council carried out a six-week trial to explore ways of making a shopping street more comfortable in summer. It installed removable shade canopies above a short section of pavement. A second section, with similar buildings but no canopies, was used for comparison.

Sensors measured pavement surface temperature at both locations every hour. During the trial, the shaded pavement was cooler at midday on most sunny days. However, the sensors did not measure air temperature, so the researchers could not say whether the air itself had become cooler.

Shopkeepers were also asked for their views. Most said that customers seemed more willing to stop outside their shops, but the council did not collect sales figures. Before deciding whether to extend the project, it plans to test the canopies during windy weather and estimate their maintenance costs.`, [
      {type:'choice', question:'The sensors recorded the temperature of the air. Choose TRUE, FALSE or NOT GIVEN.', options:['TRUE','FALSE','NOT GIVEN'], answer:1, explanation:'第二段明确说传感器测量路面表面温度，没有测量空气温度，因此该陈述与原文相反。'},
      {type:'choice', question:'The shops sold more products during the trial. Choose TRUE, FALSE or NOT GIVEN.', options:['TRUE','FALSE','NOT GIVEN'], answer:2, explanation:'店主只表示顾客似乎更愿意停留，市政部门没有收集销售数据。文章不能确认销量是否增加，因此选 NOT GIVEN。'},
      {type:'fill', question:'Complete the sentence with ONE word from the passage: The council plans to estimate the canopies\' _____ costs.', blanks:[{answers:['maintenance']}], answer:[['maintenance']], explanation:'最后一句指出，扩大项目前会评估维护成本，即 maintenance costs。'}
    ]),
  bank('ielts-reading-repair-v1', '雅思阅读入门 · 社区维修工作坊', 'ielts', '阅读方法',
    'Learning to Repair',
    `At a monthly workshop in a community hall, volunteers help residents repair small household objects. The organizers say that reducing waste is one aim, but teaching practical skills is equally important. Visitors are encouraged to work alongside a volunteer rather than leave an item and collect it later.

Each session lasts three hours. People book a time slot in advance and describe the object they want to bring. This helps organizers find a volunteer with suitable skills. The workshop provides basic tools, while visitors must pay for any replacement parts they need. Repairs are not guaranteed: some objects are unsafe to open, and others require parts that are no longer available.

After its first year, the team surveyed visitors. Many reported feeling more confident about checking simple problems themselves. The survey did not track what happened to items that could not be repaired. The organizers therefore avoided estimating how much waste the workshop had prevented. They plan to improve their records in the following year.`, [
      {type:'multiple', question:'Choose TWO aims of the workshop that are stated in the passage.', options:['To sell new household objects.','To reduce waste.','To teach practical skills.','To guarantee that every object is repaired.'], answer:[1,2], explanation:'第一段把减少废弃物和教授实用技能列为目标；原文也明确说明维修并不保证成功。'},
      {type:'fill', question:'Complete the sentence with NO MORE THAN TWO words from the passage: Visitors pay for any _____ they need.', blanks:[{answers:['replacement parts']}], answer:[['replacement parts']], explanation:'第二段写道 visitors must pay for any replacement parts they need，因此答案是 replacement parts。'},
      {type:'choice', question:'Why did the organizers avoid estimating the amount of waste prevented?', options:['Every visitor refused to answer the survey.','The workshop had not completed its first year.','They only repaired objects bought in the community.','Their survey did not track the fate of items that could not be repaired.'], answer:3, explanation:'最后一段说明调查没有追踪无法修好物品的后续去向，因此数据不足以估算减少了多少废弃物。'}
    ])
];
