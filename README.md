# Pic

本地看图应用，支持 **3D 景深视差** 和（Windows）**720° 全景**。

- **macOS**：SwiftUI 原生应用
- **Windows**：Electron 复刻（PicWin）

## 下载

**Windows x64**：[Pic-1.0.0-setup.exe](https://github.com/crl/Pic/releases/download/v1.0.0/Pic-1.0.0-setup.exe)

更多版本见 [Releases](https://github.com/crl/Pic/releases)。

macOS 目前请从源码编译。

## 功能

- 打开单张图片或整个文件夹，左右键翻页
- 自适应 / 实际大小，切图交叉淡化
- **3D 景深**：鼠标移动看立体，点击对焦，底栏调节虚化与景深强度
- **720° 全景**（Windows）：宽幅图弯曲成柱面 / 球面，可调张角与弯曲；多格角色图可转盘查看
- 景深结果会缓存，同一张图再次进入 3D 更快
- 支持 JPG、PNG、GIF、WebP、HEIC、TIFF、BMP

Windows 读不到 iPhone HEIC 里的内嵌人像深度，3D 一律用 Depth Anything V2 估算。macOS 会优先使用照片自带的深度图。

## 操作

| 操作 | Windows | macOS |
| --- | --- | --- |
| 打开 | `Ctrl+O`，或拖入窗口 | `⌘O`，或拖入窗口 |
| 上一张 / 下一张 | `←` / `→` | `←` / `→` |
| 自适应 / 实际大小 | `Ctrl+0` / `Ctrl+1` | `⌘0` / `⌘1` |
| 切换显示模式 | `Space` | `Space` |
| 3D 景深 | `Ctrl+3`，或标题栏立方体 | `⌘3` |
| 720° 全景 | 标题栏地球图标 | — |
| 3D 里看立体 | 移动鼠标 | 移动鼠标 |
| 3D 里对焦 | 点击画面 | 点击画面 |
| 全景环视 / 转盘 | 拖动，滚轮缩放 | — |

## Windows 从源码运行

```powershell
cd PicWin
$env:ELECTRON_MIRROR = "https://npmmirror.com/mirrors/electron/"
npm install --registry=https://registry.npmmirror.com
npm run fetch-model
npm run dev
```

`fetch-model` 会从 Hugging Face（失败则走 hf-mirror）下载 Depth Anything V2 Small ONNX 到 `PicWin/resources/models/`。没有模型时仍可看图，开启 3D 会提示找不到模型。

打包安装包：

```powershell
cd PicWin
npm run dist
```

产物在 `PicWin/release/Pic-1.0.0-setup.exe`。

## macOS 从源码运行

用 Xcode 打开仓库中的 `Pic` 工程，选择 Mac 目标后运行。3D 使用内置的 Depth Anything V2 Core ML 模型。
