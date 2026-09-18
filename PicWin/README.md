# PicWin

macOS [Pic](https://github.com/crl/Pic) 的 Windows 复刻：本地看图 + 3D 景深视差。

## 运行

```bash
cd PicWin
npm install
npm run fetch-model
npm run dev
```

国内网络建议先设置 Electron 镜像再安装：

```powershell
$env:ELECTRON_MIRROR = "https://npmmirror.com/mirrors/electron/"
npm install --registry=https://registry.npmmirror.com
```

`fetch-model` 会从 Hugging Face（失败则走 hf-mirror）下载 Depth Anything V2 Small ONNX 到 `resources/models/`。没有模型时仍可看图，开启 3D 景深会提示找不到模型。

## 操作

- Ctrl+O 打开图片或文件夹
- 左右方向键翻页
- Ctrl+0 自适应 / Ctrl+1 实际大小 / 空格切换
- Ctrl+3 开关 3D 景深；移动鼠标看立体，点击对焦，底栏调虚化

Windows 读不到 iPhone HEIC 里的内嵌人像深度，3D 一律走模型估算。
