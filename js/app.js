kuromoji.builder({ dicPath: "dict" }).build((err, _tokenizer) => {
    if (err) {
        // 在控制台打印具体的错误原因
        console.error("Kuromoji 词典初始化失败:", err);
        
        // 在界面上给个温柔的提示
        const loadingText = document.getElementById('loading-text');
        if (loadingText) {
            loadingText.innerText = '🌸 词典加载失败，请检查配置或刷新重试';
            loadingText.style.color = '#ff85a2'; // 换成你的 fuwari-accent 色
        }
        
        // 【可选】为了防止彻底卡死，报错 3 秒后强制进入页面
        setTimeout(() => {
            const mask = document.getElementById('loading-mask');
            if (mask) mask.style.display = 'none';
        }, 3000);
        
        return;
    }
    
    // 成功加载的原本逻辑
    tokenizer = _tokenizer;
    document.getElementById('loading-bar').style.width = '100%';
    document.getElementById('loading-text').innerText = '词典加载完成！';
    setTimeout(() => { 
        document.getElementById('loading-mask').style.display = 'none'; 
    }, 500);
});
