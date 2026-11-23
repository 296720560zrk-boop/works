# 锦衣小裁缝

小手一裁，宋锦上身——给自己挑料子、配花纹，做一身宋锦衣裳。

- 可安装到桌面（PWA），装好后离线也能玩
- 逻辑与样式全部内嵌在 `index.html` 单文件里，改起来方便

## 运行

```bash
python -m http.server 8080
# 打开 http://localhost:8080/
```

Service Worker 需要 http(s) 或 localhost 才会注册。

## 文件

| 文件 / 目录 | 作用 |
|---|---|
| `index.html` | 入口 + 全部逻辑样式 |
| `sw.js` | Service Worker，离线缓存 |
| `manifest.webmanifest` | PWA 安装配置 |
| `icons/` | 应用图标（192 / 512） |
| `looks/` | 服装外观素材 |
| `vendor/` | 第三方依赖 |
