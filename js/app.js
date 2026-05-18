console.log("【探测 1】代码已经执行到了 kuromoji.builder 这一行");

kuromoji.builder({ dicPath: "dict" }).build((err, _tokenizer) => {
    console.log("【探测 2】已经成功进入了 build 的回调函数！");
    
    if (err) {
        console.log("【探测 3-失败】进入了错误分支，错误信息是:", err);
        return;
    }
    
    console.log("【探测 3-成功】词典解析顺利完成，准备取消遮罩！");
    
    tokenizer = _tokenizer;
    document.getElementById('loading-bar').style.width = '100%';
    document.getElementById('loading-text').innerText = '词典加载完成！';
    
    setTimeout(() => { 
        console.log("【探测 4】打完收工，执行隐藏遮罩");
        document.getElementById('loading-mask').style.display = 'none'; 
    }, 500);
});
