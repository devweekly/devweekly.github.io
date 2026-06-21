https://docs.opensearch.org/latest/search-plugins/search-relevance/rerank-cross-encoder/

You can rerank search results using a cross-encoder model in order to improve search relevance. To implement reranking, you need to configure a search pipeline that runs at search time. The search pipeline intercepts search results and applies the rerank processor to them. The rerank processor evaluates the search results and sorts them based on the new scores provided by the cross-encoder model.
您可以使用交叉编码器模型对搜索结果进行重新排序，以提升搜索相关性。要实现重新排序，需要配置在搜索时运行的搜索管道。该搜索管道拦截搜索结果并对其应用 rerank 处理器。rerank 处理器评估搜索结果，并根据交叉编码器模型提供的新分数对其进行排序。

PREREQUISITE
Before configuring a reranking pipeline, you must set up a cross-encoder model. For information about using an OpenSearch-provided model, see Cross-encoder models. For information about using a custom model, see Custom local models.
先决条件 在配置重新排序管道之前，必须先设置交叉编码器模型。有关使用 OpenSearch 提供的模型的信息，请参阅《交叉编码器模型》。有关使用自定义模型的信息，请参阅《自定义本地模型》。

The following table provides a list of cross-encoder models and artifact links you can use to download them. Note that you must prefix the model name with huggingface/cross-encoders, as shown in the Model name column.

huggingface/cross-encoders/ms-marco-MiniLM-L-12-v2	1.0.2