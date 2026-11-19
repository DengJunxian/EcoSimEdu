import conceptList from "../../content/concepts.json" with { type: "json" };

export type Course = {
  id: string;
  title: string;
  question: string;
  concepts: readonly string[];
  after?: readonly string[];
};

type Pathway = {
  id: string;
  title: string;
  summary: string;
  courses: readonly Course[];
};

export const pathways: readonly Pathway[] = [
  {
    id: "market", title: "个体激励与市场出清",
    summary: "先看买卖双方如何成交，再看没有价格的学位如何分配。",
    courses: [
      { id: "double_auction", title: "双向拍卖", question: "两张报价相遇时，成交价由谁决定？",
        concepts: ["C02"] },
      { id: "school_matching", title: "学校匹配", question: "按真实偏好填志愿，会错失机会吗？",
        concepts: ["C12"], after: ["double_auction"] },
    ],
  },
  {
    id: "information", title: "信息不对称与市场失灵",
    summary: "从买家看不见商品质量出发，观察人们如何用别人的行动更新判断。",
    courses: [
      { id: "lemons_market", title: "柠檬市场", question: "当买家辨不出质量，好商品为什么退出？",
        concepts: ["C02", "C08"] },
      { id: "information_cascade", title: "信息级联", question: "连续几个人选了 A，代表几份独立证据？",
        concepts: ["C08", "C11"], after: ["lemons_market"] },
    ],
  },
  {
    id: "emergence", title: "外部性、博弈与微观涌现",
    summary: "先追踪一次搬迁，再选公共品或公地探索群体结果，最后用配额比较制度。",
    courses: [
      { id: "schelling_segregation", title: "居住隔离", question: "一位居民搬家，为什么会改变没有搬家的人？",
        concepts: ["C06"] },
      { id: "public_goods", title: "公共品博弈", question: "每个人都希望少出一点，公共池会怎样？",
        concepts: ["C03", "C07"], after: ["schelling_segregation"] },
      { id: "commons_governance", title: "公地治理", question: "今天多取一点，下一期还剩多少？",
        concepts: ["C04", "C07"], after: ["schelling_segregation"] },
      { id: "carbon_market", title: "碳配额市场", question: "在相同排放总量下，谁承担减排？",
        concepts: ["C02", "C10"], after: ["public_goods", "commons_governance"] },
    ],
  },
  {
    id: "transmission", title: "复杂系统与宏观金融传导",
    summary: "从供应链的库存与延迟学起，接着追踪银行支付，再选一个市场事件分析流动性。",
    courses: [
      { id: "beer_game", title: "啤酒游戏", question: "终端需求稍微上升，工厂为什么大幅加产？",
        concepts: ["C04"] },
      { id: "svb_run", title: "硅谷银行挤兑", question: "银行还有资产，工资款为什么付不出去？",
        concepts: ["C04", "C13"], after: ["beer_game"] },
      { id: "gamestop", title: "GameStop 交易热潮", question: "关注、买单和空头回补怎样相互影响？",
        concepts: ["C05", "C08", "C14"], after: ["svb_run"] },
      { id: "flash_crash", title: "闪电崩盘", question: "成交还在继续时，订单簿为什么会变薄？",
        concepts: ["C05", "C14"], after: ["svb_run"] },
    ],
  },
];

export const courseById = Object.fromEntries(pathways.flatMap(path =>
  path.courses.map(course => [course.id, course] as const)));
export const concepts = Object.fromEntries(conceptList.map(concept => [concept.id, concept] as const));
