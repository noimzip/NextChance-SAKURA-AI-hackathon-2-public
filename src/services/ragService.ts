import { sakuraFetch } from "./sakuraAI";

export interface RagSuggestionSource {
  documentId?: string;
  title?: string;
  chunkIndex?: number;
  content?: string;
}

export interface RagBelongingsSuggestion {
  item: string;
  sourceScheduleTitles: string[];
}

interface RagQueryRequest {
  query: string;
  tags?: string[];
  top_k?: number;
  threshold?: number;
}

interface RagQueryResult {
  content?: string;
  document?: {
    id?: string;
    name?: string;
  };
  chunk_index?: number;
}

interface RagQueryResponse {
  results?: RagQueryResult[];
}

export interface RagBelongingsSuggestionResult {
  suggestions: RagBelongingsSuggestion[];
  sources: RagSuggestionSource[];
}

function normalizeItemsFromContent(content: string): string[] {
  return content
    .split(/[\n、,，;；・/／|｜]/g)
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
    .slice(0, 6);
}

export async function queryBelongingsSuggestionsFromRag(
  query: string,
  options: { tags?: string[]; topK?: number; threshold?: number } = {},
): Promise<RagBelongingsSuggestionResult> {
  const body: RagQueryRequest = {
    query,
    ...(options.tags && options.tags.length > 0 ? { tags: options.tags } : {}),
    ...(typeof options.topK === "number" ? { top_k: options.topK } : {}),
    ...(typeof options.threshold === "number" ? { threshold: options.threshold } : {}),
  };

  const response = await sakuraFetch<RagQueryResponse>("/documents/query/", {
    body,
  });

  const results = Array.isArray(response.results) ? response.results : [];
  const suggestionMap = new Map<string, RagBelongingsSuggestion>();
  const sources: RagSuggestionSource[] = [];

  for (const result of results) {
    const content = typeof result.content === "string" ? result.content : "";
    const sourceTitle = result.document?.name;
    const items = normalizeItemsFromContent(content);
    for (const item of items) {
      const existing = suggestionMap.get(item);
      if (!existing) {
        suggestionMap.set(item, {
          item,
          sourceScheduleTitles: sourceTitle ? [sourceTitle] : [],
        });
        continue;
      }
      if (sourceTitle && !existing.sourceScheduleTitles.includes(sourceTitle)) {
        existing.sourceScheduleTitles.push(sourceTitle);
      }
    }
    sources.push({
      documentId: result.document?.id,
      title: sourceTitle,
      chunkIndex: result.chunk_index,
      content,
    });
  }

  return {
    suggestions: [...suggestionMap.values()],
    sources,
  };
}
