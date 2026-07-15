export type TimelineEntry = {
  date: `${number}-${number}`;
  title: string;
  description: string;
};

export const timeline = [
  {
    date: "2026-03",
    title: "创建这间网络小屋",
    description: "确定 Mizuki. 的名字，把动画、代码与生活碎片放进同一份写作计划。",
  },
  {
    date: "2026-04",
    title: "开始记录动画随记",
    description: "用短笔记保存喜欢的镜头、声音和观看当下的心情。",
  },
  {
    date: "2026-06",
    title: "发布第一篇开发笔记",
    description: "把搭建过程中的取舍整理成可复查、可继续补充的技术记录。",
  },
  {
    date: "2026-07",
    title: "打开留言簿",
    description: "为来访者留下一处安静的交流入口，也提醒自己认真回应每次相遇。",
  },
] as const satisfies readonly TimelineEntry[];
