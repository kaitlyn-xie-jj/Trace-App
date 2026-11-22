
import { GoogleGenAI, Type } from "@google/genai";
import { AIAnalysisResult, SceneRecord, ChatMessage, SceneType, ChatAIResponse } from "../types";

export const analyzeImage = async (base64Image: string, knownSpaces: string[] = []): Promise<AIAnalysisResult> => {
  const apiKey = import.meta.env.VITE_GEMINI_API_KEY || "";
  const ai = new GoogleGenAI({ apiKey });
  const MAX_REPETITIONS = 4;

  const spacesContext = knownSpaces.length > 0
    ? `已知空间列表：${knownSpaces.join(', ')}。请优先从列表中选择最匹配的空间。如果都不匹配，请根据画面内容推测一个新的空间名称（如：书房、卧室、厨房、客厅）。`
    : `请根据画面内容，推测并总结这是一个什么空间（例如：书房、卧室、厨房、客厅），作为 suggestedSpace 返回。`;

  const scanTask = async () => {
      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: [
          {
            parts: [
              {
                inlineData: {
                  mimeType: "image/jpeg",
                  data: base64Image.split(',')[1] || base64Image,
                },
              },
              {
                text: `你是一个极度细致的收纳识别专家。请扫描这张照片，找出其中所有的**独立小物品**。
                【铁律】不要识别容器（如抽屉、盒子、柜子本身），只识别里面的内容物。
                请返回物品名称、分类、位置描述、2D坐标[xmin, ymin, xmax, ymax]（0-1000归一化）、是否为易腐/生鲜物品（isPerishable），以及预计保质期天数（shelfLifeDays，如果是食品）。
                同时，${spacesContext}
                然后，推测这是一个什么具体位置（例如：书桌、冰箱内部、茶几、床头柜），作为 suggestedLocation 返回。**注意：suggestedLocation 不要包含 suggestedSpace 的名称**。`,
              },
            ],
          },
        ],
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              suggestedSpace: { type: Type.STRING },
              suggestedLocation: { type: Type.STRING },
              items: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    itemName: { type: Type.STRING },
                    category: { type: Type.STRING },
                    scene: { type: Type.STRING, enum: Object.values(SceneType) },
                    preciseLocation: { type: Type.STRING },
                    remarks: { type: Type.STRING },
                    shelfLifeDays: { type: Type.NUMBER },
                    isPerishable: { type: Type.BOOLEAN },
                    box_2d: { type: Type.ARRAY, items: { type: Type.NUMBER } },
                  },
                  required: ["itemName", "category", "scene", "preciseLocation", "remarks", "box_2d"],
                },
              },
            },
            required: ["items", "suggestedLocation"],
          },
        },
      });
      const parsed = JSON.parse(response.text) as AIAnalysisResult;
      if (!parsed || !Array.isArray(parsed.items)) throw new Error('Gemini returned invalid items');
      return parsed;
  };

  const attempts = await Promise.allSettled(Array.from({ length: MAX_REPETITIONS }, () => scanTask()));
  const successful = attempts
    .filter((result): result is PromiseFulfilledResult<AIAnalysisResult> => result.status === 'fulfilled')
    .map(result => result.value);
  if (successful.length === 0) {
    throw new Error('Gemini recognition failed for every attempt');
  }
  return successful.reduce((best, current) =>
    current.items.length > best.items.length ? current : best
  );
};

export const queryInventory = async (
  query: string,
  scenes: SceneRecord[],
  chatHistory: ChatMessage[]
): Promise<ChatAIResponse> => {
  const apiKey = import.meta.env.VITE_GEMINI_API_KEY || "";
  const ai = new GoogleGenAI({ apiKey });

  const memoryContext = scenes.length > 0
    ? scenes.map(s => `[场景ID:${s.id}, 位置:${s.locationCategory}] 包含物品: ${s.items.map(i => i.itemName).join(', ')}`).join('\n')
    : "当前没有任何视觉记忆记录。";

  const systemInstruction = `你是一个“视觉记忆”管家。你的回答必须基于用户提供的“场景记忆”。
  
  【回答规则】
  1. 首先在“场景记忆”中搜索用户寻找的物品。
  2. **如果找到了**：
     - 告知物品所在的具体位置（场景名称/位置描述）。
     - 必须返回 matchedSceneIds 和 matchedItemDetails。
  3. **如果没找到**：
     - 你的首要回答应该是：“在已记录的画面中没找到[物品名]”。
     - **关键优化**：如果用户的问题包含“可能在哪”、“建议”、“猜一下”等寻求建议的意图，或者你认为提供建议会有帮助，请利用你的常识提供**推测性建议**。
       - 例如：“我没拍到过三文鱼罐头，但通常这类物品会在厨房的橱柜或储藏室里。”
       - 注意：必须明确说明这是“建议”或“推测”，而不是记忆。
     - 此时 matchedSceneIds 应为空列表。
  4. 你的回答必须非常简短。**严禁在回答中提及“场景ID”、“标记”或“ID”等技术术语**。
  5. **关键点**：必须返回 matchedItemDetails 列表，明确指明在哪个场景里匹配到了哪个具体物品名称（必须与原始数据完全一致）。`;

  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: [
      ...chatHistory.map(m => ({ role: m.role, parts: [{ text: m.content }] })),
      { role: "user", parts: [{ text: `用户提问: ${query}\n\n我的视觉记忆内容:\n${memoryContext}` }] }
    ],
    config: {
      systemInstruction,
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          answer: { type: Type.STRING },
          matchedSceneIds: { type: Type.ARRAY, items: { type: Type.STRING } },
          matchedItemDetails: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                sceneId: { type: Type.STRING },
                itemName: { type: Type.STRING }
              }
            }
          }
        },
        required: ["answer", "matchedSceneIds", "matchedItemDetails"]
      }
    },
  });

  return JSON.parse(response.text);
};
