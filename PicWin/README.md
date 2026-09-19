# PicWin

[Pic](https://github.com/crl/Pic) 的 Windows 端。下载安装包、快捷键和完整说明见仓库根目录 [README](../README.md)。

**安装包：** [Pic-1.0.0-setup.exe](https://github.com/crl/Pic/releases/download/v1.0.0/Pic-1.0.0-setup.exe)

## 开发

```powershell
cd PicWin
$env:ELECTRON_MIRROR = "https://npmmirror.com/mirrors/electron/"
npm install --registry=https://registry.npmmirror.com
npm run fetch-model
npm run dev
```

打包：`npm run dist`，安装包输出到 `release/`。
