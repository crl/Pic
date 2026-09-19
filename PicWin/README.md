# PicWin

[Pic](https://github.com/crl/Pic) 的 Windows 端，使用 Tauri 2 + 系统 WebView2。下载安装包、快捷键和完整说明见仓库根目录 [README](../README.md)。

**安装包：** [Pic_1.1.0_x64-setup.exe](https://github.com/crl/Pic/releases/download/v1.1.0/Pic_1.1.0_x64-setup.exe)

## 开发

需要 [Rust](https://www.rust-lang.org/tools/install) 与 Windows 上的 WebView2（Win10/11 通常已自带）。

```powershell
cd PicWin
npm install
npm run fetch-model
npm run dev
```

打包：

```powershell
npm run dist
```

安装包在 `src-tauri/target/release/bundle/nsis/Pic_1.1.0_x64-setup.exe`（约 26MB）。
