kuromoji.builder({ dicPath: "dict" }).build((err, _tokenizer) => {
    if (err) return;
    tokenizer = _tokenizer;
    document.getElementById('loading-bar').style.width = '100%';
    document.getElementById('loading-text').innerText = '词典加载完成！';
    setTimeout(() => { document.getElementById('loading-mask').style.display = 'none'; }, 500);
});
