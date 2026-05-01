import type { Site, SocialObjects } from "./types";

export const SITE: Site = {
  website: "https://devweekly.github.io", // replace this with your deployed domain
  author: "SW",
  desc: "Developer Weekly - 开发者周报，每周精选编程技术、架构设计、AI/LLM、Web开发、产品思维与设计资源。Developer Weekly, 开发周报, 编程周报, 技术周报, programming weekly, coding newsletter",
  title: "Dev Weekly - 开发者周报 | Developer Weekly Programming Newsletter",
  ogImage: "astropaper-og.jpg",
  lightAndDarkMode: true,
  postPerPage: 5,
  scheduledPostMargin: 15 * 60 * 1000, // 15 minutes
};

export const LOCALE = {
  lang: "en", // html lang code. Set this empty and default will be "en"
  langTag: ["en-EN"], // BCP 47 Language Tags. Set this empty [] to use the environment default
} as const;

export const LOGO_IMAGE = {
  enable: false,
  svg: true,
  width: 216,
  height: 46,
};

export const SOCIALS: SocialObjects = [
  {
    name: "Github",
    href: "https://github.com/devweekly/devweekly.github.io",
    linkTitle: ` ${SITE.title} on Github`,
    active: true,
  },
];
