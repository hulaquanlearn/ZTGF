// Original starter material. These small sets are not complete exam word lists.
const englishRows = `早餐|breakfast|名词|日常生活|I usually have breakfast at seven.|我通常七点吃早餐。
图书馆|library|名词|学习|The library is next to the station.|图书馆在车站旁边。
邻居|neighbor|名词|日常生活|Our neighbor grows vegetables.|我们的邻居种蔬菜。
旅程|journey|名词|旅行|The train journey takes two hours.|这趟火车旅程需要两个小时。
天气|weather|名词|日常生活|The weather is warm today.|今天天气暖和。
预约|appointment|名词|日常生活|I have an appointment at ten.|我十点有一个预约。
准备|prepare|动词|学习|Please prepare three questions for the lesson.|请为这节课准备三个问题。
练习|practice|动词|学习|I practice speaking English every day.|我每天练习说英语。
借入|borrow|动词|学习|May I borrow your dictionary?|我可以借用你的词典吗？
借出|lend|动词|学习|Can you lend me a pen?|你能借给我一支笔吗？
到达|arrive|动词|旅行|We will arrive before lunch.|我们将在午饭前到达。
决定|decide|动词|日常生活|We need to decide where to meet.|我们需要决定在哪里见面。
改进|improve|动词|学习|Regular reading can improve your vocabulary.|经常阅读可以增加你的词汇量。
记得|remember|动词|学习|Remember to bring your notebook.|记得带上你的笔记本。
忘记|forget|动词|日常生活|Do not forget your keys.|不要忘记带钥匙。
选择|choose|动词|日常生活|You can choose one of these books.|你可以从这些书中选一本。
解释|explain|动词|学习|Could you explain this word?|你能解释一下这个词吗？
描述|describe|动词|学习|Please describe your favorite place.|请描述一下你最喜欢的地方。
邀请|invite|动词|日常生活|We plan to invite our friends to dinner.|我们计划邀请朋友来吃晚饭。
分享|share|动词|日常生活|Let us share our ideas.|让我们分享各自的想法。
仔细的|careful|形容词|学习|A careful reader notices small details.|细心的读者会注意到小细节。
舒适的|comfortable|形容词|日常生活|This chair is comfortable.|这把椅子很舒适。
方便的|convenient|形容词|旅行|The bus stop is in a convenient location.|这个公交站的位置很方便。
重要的|important|形容词|学习|Sleep is important for learning.|睡眠对学习很重要。
可能的|possible|形容词|日常生活|Is it possible to change the time?|可以更改时间吗？
安静的|quiet|形容词|学习|We found a quiet room to study in.|我们找到了一间安静的房间学习。
通常|usually|副词|日常生活|She usually walks to work.|她通常步行上班。
一起|together|副词|日常生活|We cooked dinner together.|我们一起做了晚饭。
足够的|enough|限定词|日常生活|We have enough time to finish.|我们有足够的时间完成。
虽然|although|连词|学习|Although it was raining, we went out.|虽然下着雨，我们还是出门了。`;

const postgraduateRows = `分析|analyze|动词|学术阅读|The researchers analyze the survey results.|研究人员分析调查结果。
方法|approach|名词|学术阅读|This approach combines observation and interviews.|这种方法结合了观察和访谈。
假设|assume|动词|学术阅读|We should not assume that every reader agrees.|我们不应假设每位读者都同意。
益处|benefit|名词|学术阅读|One benefit of the plan is lower cost.|该计划的一个益处是成本更低。
挑战|challenge|名词|学术阅读|Finding reliable information is a challenge.|找到可靠的信息是一项挑战。
概念|concept|名词|学术阅读|The article introduces a new concept.|这篇文章介绍了一个新概念。
后果|consequence|名词|学术阅读|A possible consequence is a longer waiting time.|一种可能的后果是等待时间更长。
语境|context|名词|阅读方法|The meaning of a word depends on its context.|一个词的含义取决于其语境。
对比|contrast|名词|阅读方法|There is a clear contrast between the two views.|这两种观点形成鲜明对比。
贡献|contribute|动词|写作|Many volunteers contribute their time to the project.|许多志愿者为这个项目贡献自己的时间。
定义|define|动词|学术阅读|The author begins by trying to define success.|作者首先尝试定义成功。
表明|demonstrate|动词|写作|The results demonstrate the value of regular practice.|这些结果表明了经常练习的价值。
源自|derive|动词|阅读方法|Some English words derive from Latin.|一些英语单词源自拉丁语。
分配|distribute|动词|学术阅读|The team will distribute the tasks fairly.|团队将公平地分配任务。
经济|economy|名词|社会|Tourism is important to the local economy.|旅游业对当地经济很重要。
环境|environment|名词|社会|A supportive environment helps students learn.|支持性的环境有助于学生学习。
证据|evidence|名词|阅读方法|The report provides evidence for this claim.|这份报告为这一说法提供了证据。
因素|factor|名词|学术阅读|Cost is only one factor in the decision.|成本只是决策中的一个因素。
功能|function|名词|学术阅读|The main function of this tool is to organize notes.|这个工具的主要功能是整理笔记。
识别|identify|动词|阅读方法|Try to identify the main argument.|尝试找出主要论点。
显示|indicate|动词|阅读方法|These figures indicate a change in demand.|这些数字显示需求发生了变化。
个人|individual|名词|社会|Each individual may have different needs.|每个人可能有不同的需求。
解读|interpret|动词|阅读方法|Readers may interpret the same text differently.|读者可能会对同一篇文章作出不同解读。
议题|issue|名词|写作|The meeting focused on one important issue.|会议重点讨论了一个重要议题。
发生|occur|动词|阅读方法|Most errors occur during the first stage.|大多数错误发生在第一阶段。
政策|policy|名词|社会|The new policy encourages public transport use.|新政策鼓励使用公共交通。
原则|principle|名词|学术阅读|Fairness is a basic principle of the system.|公平是这个制度的一项基本原则。
过程|process|名词|学术阅读|Learning a language is a gradual process.|学习一门语言是一个渐进的过程。
需要|require|动词|阅读方法|This task will require careful planning.|这项任务需要仔细规划。
理论|theory|名词|学术阅读|The experiment was designed to test the theory.|这项实验旨在检验该理论。`;

const ieltsRows = `住宿|accommodation|名词|生活服务|Students can apply for accommodation on campus.|学生可以申请校内住宿。
广告|advertisement|名词|媒体|The advertisement gives the opening times.|这则广告列出了营业时间。
农业|agriculture|名词|环境|Water management is important in agriculture.|水资源管理在农业中很重要。
建筑设计|architecture|名词|城市|The museum is known for its modern architecture.|这家博物馆以其现代建筑设计而闻名。
生物多样性|biodiversity|名词|环境|Protecting habitats helps preserve biodiversity.|保护栖息地有助于保护生物多样性。
气候|climate|名词|环境|The region has a dry climate.|这个地区气候干燥。
通勤|commute|动词|交通|Many residents commute by train.|许多居民乘火车通勤。
消费者|consumer|名词|经济|A consumer can compare prices online.|消费者可以在网上比较价格。
文化|culture|名词|社会|Food is an important part of local culture.|饮食是当地文化的重要组成部分。
下降|decline|动词|图表表达|The figures show that sales began to decline in May.|这些数字显示销量在五月开始下降。
教育|education|名词|社会|The city plans to invest more in education.|这座城市计划在教育方面增加投入。
排放|emission|名词|环境|The emission of smoke was recorded by a sensor.|传感器记录了烟雾的排放。
就业|employment|名词|社会|The factory provides employment for local residents.|这家工厂为当地居民提供就业机会。
能源|energy|名词|环境|The building uses less energy in summer.|这栋建筑在夏季消耗的能源更少。
全球化|globalization|名词|社会|Globalization has changed how some companies operate.|全球化改变了一些公司的运营方式。
医疗保健|healthcare|名词|社会|Rural communities need access to healthcare.|农村社区需要能够获得医疗保健服务。
基础设施|infrastructure|名词|城市|The town is improving its transport infrastructure.|这个城镇正在改善交通基础设施。
创新|innovation|名词|科技|The award recognizes innovation in product design.|这个奖项表彰产品设计方面的创新。
迁移|migration|名词|社会|The study examines migration from villages to cities.|这项研究考察了从乡村向城市的迁移。
人口|population|名词|图表表达|The town has a population of twenty thousand.|这个城镇有两万人口。
污染|pollution|名词|环境|The project aims to reduce water pollution.|该项目旨在减少水污染。
比例|proportion|名词|图表表达|A large proportion of students travel by bus.|很大一部分学生乘公交车出行。
回收利用|recycle|动词|环境|The school asks students to recycle paper.|学校要求学生回收利用纸张。
资源|resource|名词|环境|Fresh water is a valuable resource.|淡水是一种宝贵的资源。
可持续的|sustainable|形容词|写作|The council supports sustainable forms of transport.|议会支持可持续的交通方式。
技术|technology|名词|科技|New technology can change the way people work.|新技术可以改变人们的工作方式。
交通运输|transport|名词|城市|Public transport links the center with nearby towns.|公共交通连接市中心和附近的城镇。
城市的|urban|形容词|城市|Urban parks offer space for outdoor activities.|城市公园为户外活动提供空间。
福利|welfare|名词|社会|The organization works to improve animal welfare.|这个组织致力于改善动物福利。
野生动物|wildlife|名词|环境|Visitors should avoid disturbing local wildlife.|游客应避免打扰当地野生动物。`;

function parse(rows, track, difficulty) {
  return rows.split('\n').map(line => {
    const [zh, en, partOfSpeech, chapter, exampleEn, exampleZh] = line.split('|');
    return {
      zh, en, track, partOfSpeech, meanings:[zh], exampleEn, exampleZh,
      acceptedEn:en === 'neighbor' ? ['neighbour'] : en === 'analyze' ? ['analyse'] : en === 'globalization' ? ['globalisation'] : [],
      chapter, difficulty, tags:['内置入门词库', chapter],
      source:'智题工坊原创入门词库 v6', license:'项目原创内容',
      attribution:'本项目编写的学习示例，非官方考试完整词表。',
      reviewStatus:'approved', needsReview:false
    };
  });
}

export const seedVocabulary = [
  ...parse(englishRows, 'english', 1),
  ...parse(postgraduateRows, 'postgraduate', 3),
  ...parse(ieltsRows, 'ielts', 3)
];
