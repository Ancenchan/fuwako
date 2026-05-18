// 原来 init() 保持不变
init();

// 引用路径：
// kuromoji builder dictPath 保持 dict
kuromoji.builder({ dicPath: "dict" }).build((err, tokenizer) => {...});
