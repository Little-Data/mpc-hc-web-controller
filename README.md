# MPC-HC 网页控制器

一个 [MPC-HC](https://github.com/clsid2/mpc-hc) 网页端控制器，可通过网页界面便捷地操作 MPC-HC 的各项播放控制功能。

**注意！MPC-HC的接口没有任何保护，请谨慎开放使用，以免被他人利用漏洞！**

如果你想找适用于 [MPC-BE](https://github.com/Aleksoid1978/MPC-BE) 的网页控制器，请转到 [MPC-BE 网页控制器](https://github.com/little-Data/mpc-be-web-controller)

**因为我习惯使用MPC-BE，更多细节请到[MPC-BE 网页控制器](https://github.com/little-Data/mpc-be-web-controller)中查看，HC与BE绝大部分是相同的。**

测试时的版本：2.6.1

# 使用

从 [Releases](https://github.com/little-Data/mpc-hc-web-controller/releases) 中下载`mpc-hc-web-controller.7z`文件，解压全部文件至一个文件夹中。

打开MPC-HC，点击查看>选项>Web 界面

打开监听端口，启用预览（如果想在页面内显示画面的话），服务页面来自。

复制刚才解压文件到那个文件夹的路径，粘贴到服务页面来自下的输入框中。

点击“应用”，点在网页浏览器中打开即可看到页面。

# 在线使用

**注意：设计之初就是要下载后在本地使用的，能够在线使用风险更高！请自己做好防护！**

**因HC不像BE那样需要解决CORS，使用更方便了，但也增加了风险！**

打开[在线地址](https://little-data.github.io/mpc-hc-web-controller)，找到“杂项控制”，填写“控制地址”并设置。

页面底部有`[debug]`字样是正常的，该设计在本地使用时如果开启了MPC-HC调试信息就会在此显示。但在线使用时MPC-HC无法替换为调试信息。

# License

MIT

尊重成果，请注意表明来源和署名，不允许将署名抹掉后重新发布！

Respect the results, please be careful to indicate the source and attribution, and republishing after erasing the attribution is not allowed! 

# 额外文件

因命令过多，页面只放了一些能用且大概率会用到的按钮，其余的做成了自定义命令。

这些文件不包含在Releases的压缩文件中，自行从仓库获取。

不保证能用，点击自定义命令的导入JSON来添加。

`mpc-hc-cmds.json`：从内置页面的`/index.html`中提取，去除了已经在页面中的命令。

`mpc-hc-cmds-define.json`：从`resource.h`中提取`#define ID_`开头的数值当作命令，去除了已经在页面中，`mpc-hc-cmds.json`中的命令。名称是直接翻译的。

以下文件为后续更新使用：

`mpc-hc-define-ID_.txt`：当前版本所使用的`#define ID_`开头的数值。
