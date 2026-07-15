export type FriendLink = {
  name: string;
  url: `https://${string}.example/`;
  description: string;
  interests: readonly string[];
};

export const friendsNotice =
  "以下友链为演示数据，域名均使用 .example，不指向真实站点。";

export const friends = [
  {
    name: "春潮放映室",
    url: "https://spring-screen.example/",
    description: "记录动画分镜、配乐与片尾余韵的虚构小站。",
    interests: ["动画", "音乐"],
  },
  {
    name: "白昼代码簿",
    url: "https://daylight-code.example/",
    description: "整理前端实验和阅读笔记的虚构开发日志。",
    interests: ["前端", "开源"],
  },
  {
    name: "纸上星图",
    url: "https://paper-stars.example/",
    description: "分享小说、散文与夜间观察的虚构文字空间。",
    interests: ["阅读", "随笔"],
  },
  {
    name: "风铃照片馆",
    url: "https://windbell-photo.example/",
    description: "收集街角光影和季节颜色的虚构摄影册。",
    interests: ["摄影", "生活"],
  },
] as const satisfies readonly FriendLink[];
