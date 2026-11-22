import { AIAnalysisResult, SceneRecord, ChatMessage, SceneType, ChatAIResponse } from "../types";

const API_KEY = import.meta.env.VITE_DASHSCOPE_API_KEY || "sk-05437c944b084b288c3948746c58630e";

// Qwen VL Max API endpoint
// Use proxy path in both Dev (Vite) and Prod (Nginx) to avoid CORS issues
const QWEN_API_URL = "/dashscope-api/api/v1/services/aigc/multimodal-generation/generation";

export const analyzeImageQwen = async (base64Image: string, knownSpaces: string[] = []): Promise<AIAnalysisResult> => {
  const spacesContext = knownSpaces.length > 0
    ? `已知空间列表：${knownSpaces.join(', ')}。请优先从列表中选择最匹配的空间。如果都不匹配，请根据画面内容推测一个新的空间名称（如：书房、卧室、厨房、客厅）。`
    : `请根据画面内容，推测并总结这是一个什么空间（例如：书房、卧室、厨房、客厅），作为 suggestedSpace 返回。`;

  const prompt = `你是一个极度细致的收纳识别专家。请扫描这张照片，找出其中所有的**独立小物品**。
【铁律】不要识别容器（如抽屉、盒子、柜子本身），只识别里面的内容物。
请返回物品名称、分类、位置描述、2D坐标[xmin, ymin, xmax, ymax]（0-1000归一化）、是否为易腐/生鲜物品（isPerishable），以及预计保质期天数（shelfLifeDays，如果是食品）。

【关于保质期 shelfLifeDays 的严格规定】
1. **只有食品、饮料、药品、化妆品等有明确有效期的物品，才需要估算保质期。**
2. **对于非易耗品（如工具、文具、衣物、电子产品、金属制品、弹簧、玩具等），shelfLifeDays 必须返回 null 或 -1。** 严禁默认为 365 天。
3. 对于生鲜食品（蔬菜水果），请根据其成熟度合理估算剩余天数（通常 3-15 天）。

同时，${spacesContext}
然后，推测这是一个什么具体位置（例如：书桌、冰箱内部、茶几、床头柜），作为 suggestedLocation 返回。**注意：suggestedLocation 不要包含 suggestedSpace 的名称**。
请以JSON格式返回，不要包含Markdown格式标记（如 \`\`\`json）。
返回格式示例：
{
  "suggestedSpace": "书房",
  "suggestedLocation": "书桌",
  "items": [
    {
      "itemName": "物品名称",
      "category": "分类",
      "scene": "厨房", // 必须是以下之一：厨房, 衣柜, 书房, 地下室, 客厅, 浴室, 其他
      "preciseLocation": "位置描述",
      "remarks": "备注",
      "shelfLifeDays": null, // 非食品/易耗品请返回 null
      "isPerishable": false, // 是否为易腐/生鲜物品
      "box_2d": [0, 0, 1000, 1000] // [xmin, ymin, xmax, ymax] 对应 [左上角x, 左上角y, 右下角x, 右下角y]，必须是0-1000的归一化坐标
    }
  ]
}`;

  // Qwen VL supports base64 image data
  // Format: "data:image/png;base64,..."
  // Ensure base64Image has the prefix or add it. 
  // The user's code in geminiService.ts does: base64Image.split(',')[1] || base64Image
  // Here we likely need the full data URI for Qwen if we pass it as 'image' field?
  // Checking Qwen docs: "image": "https://..." or "data:image/jpg;base64,xxxx"

  let dataUri = base64Image;
  if (!base64Image.startsWith('data:')) {
    dataUri = `data:image/jpeg;base64,${base64Image}`;
  }

  const payload = {
    model: "qwen-vl-max",
    input: {
      messages: [
        {
          role: "user",
          content: [
            { image: dataUri },
            { text: prompt }
          ]
        }
      ]
    },
    parameters: {
      result_format: "message"
    }
  };

  try {
    const response = await fetch(QWEN_API_URL, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("Qwen API Error:", errText);
      throw new Error(`Qwen API Error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    const content = data.output?.choices?.[0]?.message?.content?.[0]?.text || data.output?.choices?.[0]?.message?.content;

    if (!content) {
      console.error("Qwen Empty Response", data);
      throw new Error('Qwen returned no recognition payload');
    }

    // Clean up markdown code blocks if present
    const cleanContent = content.replace(/```json\n?|```/g, "").trim();

    try {
      const parsed = JSON.parse(cleanContent);
      // Ensure scene is valid enum
      if (parsed.items) {
        parsed.items.forEach((item: any) => {
          if (!Object.values(SceneType).includes(item.scene)) {
            item.scene = SceneType.OTHER;
          }
          // Ensure box_2d is present
          if (!item.box_2d) {
            item.box_2d = [0, 0, 0, 0];
          }
        });
      }
      if (!Array.isArray(parsed.items)) throw new Error('Qwen returned invalid items');
      return parsed as AIAnalysisResult;
    } catch (e) {
      console.error("Failed to parse Qwen JSON:", e);
      throw new Error('Qwen recognition result was invalid');
    }

  } catch (error) {
    console.error("Qwen Service Error:", error);
    throw error;
  }
};

const locateItemInScene = async (sceneImage: string, itemName: string): Promise<number[] | undefined> => {
  try {
    const prompt = `请在图中精准框选出"${itemName}"。请返回该物品的2D坐标[xmin, ymin, xmax, ymax]（0-1000归一化）。请直接返回JSON格式：{"box_2d": [x1, y1, x2, y2]}`;

    let dataUri = sceneImage;
    if (!sceneImage.startsWith('data:')) {
      dataUri = `data:image/jpeg;base64,${sceneImage}`;
    }

    const payload = {
      model: "qwen-vl-max",
      input: {
        messages: [
          {
            role: "user",
            content: [
              { image: dataUri },
              { text: prompt }
            ]
          }
        ]
      },
      parameters: {
        result_format: "message"
      }
    };

    const response = await fetch(QWEN_API_URL, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) return undefined;

    const data = await response.json();
    const content = data.output?.choices?.[0]?.message?.content?.[0]?.text || data.output?.choices?.[0]?.message?.content;

    if (!content) return undefined;

    const cleanContent = content.replace(/```json\n?|```/g, "").trim();
    const parsed = JSON.parse(cleanContent);
    return parsed.box_2d;
  } catch (e) {
    console.error("Re-location failed:", e);
    return undefined;
  }
};

const searchItemsInContext = async (query: string, memoryContext: string): Promise<{ sceneId: string, itemName: string }[]> => {
  const searchPrompt = `你是一个精准的数据库检索助手。
用户查询: "${query}"
数据库:
${memoryContext}

请从数据库中找出所有与用户查询**语义相关**的物品。
例如：如果用户查“水果”，你要找出“苹果”、“香蕉”等。
如果用户查“红色的东西”，你要找出“可乐”、“苹果”等。

请务必返回所有匹配项。
请只返回一个JSON对象，格式如下：
{
  "matchedItems": [
    { "sceneId": "...", "itemName": "..." }
  ]
}
如果未找到，返回 { "matchedItems": [] }。不要输出任何其他内容。`;

  const payload = {
    model: "qwen-plus",
    input: {
      messages: [
        { role: "user", content: searchPrompt }
      ]
    },
    parameters: { result_format: "message" }
  };

  try {
    // ALWAYS use proxy path to avoid CORS, both in Dev and Prod (served by Express)
    const TEXT_API_URL = "/dashscope-api/api/v1/services/aigc/text-generation/generation";

    const response = await fetch(TEXT_API_URL, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) return [];
    const data = await response.json();
    const content = data.output?.choices?.[0]?.message?.content || "{}";
    const cleanContent = content.replace(/```json\n?|```/g, "").trim();
    const parsed = JSON.parse(cleanContent);
    return parsed.matchedItems || [];
  } catch (e) {
    console.error("Search step failed:", e);
    return [];
  }
};

export const queryInventoryQwen = async (
  query: string,
  scenes: SceneRecord[],
  chatHistory: ChatMessage[]
): Promise<ChatAIResponse> => {
  // Similar implementation for chat
  const memoryContext = scenes.length > 0
    ? scenes.map(s => {
      const dateStr = new Date(s.timestamp).toLocaleDateString();
      const itemsStr = s.items.map(i => {
        let info = i.itemName;
        if (i.isPerishable) {
          info += ` (易腐`;
          if (i.shelfLifeDays) info += `, 原始保质期:${i.shelfLifeDays}天`;
          info += `)`;
        }
        return info;
      }).join(', ');
      return `[场景ID:${s.id}, 位置:${s.locationCategory}, 记录日期:${dateStr}] 包含物品: ${itemsStr}`;
    }).join('\n')
    : "当前没有任何视觉记忆记录。";

  // Internal function to run a single query attempt
  const runAttempt = async (): Promise<ChatAIResponse> => {
    try {
      // --- STEP 1: RETRIEVAL (Search) ---
      const foundItems = await searchItemsInContext(query, memoryContext);

      // Construct a context specifically about what we found
      const foundContext = foundItems.length > 0
        ? `【检索结果】我在记忆库中发现了以下相关物品：${JSON.stringify(foundItems)}。请务必基于这些检索结果回答用户，并填充 matchedItemDetails。`
        : `【检索结果】我在记忆库中没有发现明确匹配的物品。`;

      const systemInstruction = `你是一个“视觉记忆”管家。今天是 ${new Date().toLocaleDateString()}。
      你的回答必须基于用户提供的“场景记忆”和“检索结果”。
      
      【回答规则】
      1. 如果【检索结果】中有物品，你必须告诉用户这些物品在什么位置。
      2. 如果【检索结果】为空：
         - 首先回答“我没在记忆中找到[物品名]”。
         - **关键优化**：如果用户询问“可能在哪”或寻求建议，请基于常识提供推测。例如：“但我建议你去厨房或储藏室找找。”
         - 严禁编造记忆。
      3. 你的回答必须非常简短。**严禁在回答中提及“场景ID”、“标记”或“ID”等技术术语**。
      4. 必须返回 matchedSceneIds。
      5. **关键点**：必须返回 matchedItemDetails 列表，明确指明在哪个场景里匹配到了哪个具体物品名称（必须与原始数据完全一致）。
      6. **关于保质期**：场景记录中有“记录日期”和物品的“原始保质期”。请根据“今天是...”主动计算物品是否过期或临期，并在回答中温馨提醒用户（例如：“注意：记录于3天前的牛奶可能快过期了”）。
      
      【重要】你必须只输出标准的 JSON 格式，严禁输出任何其他文本或 Markdown 标记。
      【思维链】在生成JSON之前，你可以先思考，但必须将思考过程放入JSON的 "_thought" 字段中，不要在JSON之外输出任何内容。
      
      请以JSON格式返回，格式如下：
      {
        "_thought": "你的思考过程...",
        "answer": "回答内容",
        "matchedSceneIds": ["场景ID1", "场景ID2"],
        "matchedItemDetails": [{"sceneId": "场景ID", "itemName": "物品名"}]
      }`;

      const messages = [
        {
          role: "system",
          content: systemInstruction
        },
        // Keep only the last 1 turn of history (last 2 messages)
        ...chatHistory.slice(-2).map(m => ({
          role: m.role === 'model' ? 'assistant' : m.role,
          content: m.content
        })),
        {
          role: "user",
          content: `用户提问: ${query}\n\n我的视觉记忆内容:\n${memoryContext}\n\n${foundContext}`
        }
      ];

      const payload = {
        model: "qwen-plus",
        input: { messages: messages },
        parameters: { result_format: "message" }
      };

      // ALWAYS use proxy path in production to avoid CORS
      const TEXT_API_URL = "/dashscope-api/api/v1/services/aigc/text-generation/generation";

      const response = await fetch(TEXT_API_URL, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${API_KEY}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        throw new Error(`Qwen Text API Error: ${response.status}`);
      }

      const data = await response.json();
      const content = data.output?.choices?.[0]?.message?.content;
      let cleanContent = content.replace(/```json\n?|```/g, "").trim();

      const firstBrace = cleanContent.indexOf('{');
      const lastBrace = cleanContent.lastIndexOf('}');
      if (firstBrace !== -1 && lastBrace !== -1) {
        cleanContent = cleanContent.substring(firstBrace, lastBrace + 1);
      }

      try {
        return JSON.parse(cleanContent) as ChatAIResponse;
      } catch (parseError) {
        console.warn("JSON parse failed, falling back to raw text:", cleanContent);
        return {
          answer: content,
          matchedSceneIds: [],
          matchedItemDetails: []
        };
      }
    } catch (e) {
      console.error("Attempt failed:", e);
      // Return a dummy error response that won't be picked if another one succeeds
      return {
        answer: "系统内部错误",
        matchedSceneIds: [],
        matchedItemDetails: []
      };
    }
  };

  // --- EXECUTE DUAL ATTEMPTS ---
  // Run 2 attempts in parallel to improve recall
  const attempts = [runAttempt(), runAttempt()];
  const results = await Promise.all(attempts);

  // Select the best result
  // Criteria:
  // 1. More matched items is better.
  // 2. If equal, prefer the one that isn't an error message (length of answer > 0).
  const bestResponse = results.reduce((best, current) => {
    const bestCount = best.matchedItemDetails?.length || 0;
    const currentCount = current.matchedItemDetails?.length || 0;

    if (currentCount > bestCount) return current;
    if (currentCount < bestCount) return best;

    // If counts are equal, maybe prefer the longer answer? or just first one.
    return best;
  });

  // --- RE-VERIFICATION LOGIC ---
  // Perform expensive visual re-verification only on the selected best response
  if (bestResponse.matchedItemDetails && bestResponse.matchedItemDetails.length > 0) {
    const itemsToVerify = bestResponse.matchedItemDetails.slice(0, 3);
    await Promise.all(itemsToVerify.map(async (detail) => {
      const scene = scenes.find(s => s.id === detail.sceneId);
      if (scene && scene.fullImageUrl) {
        const newBox = await locateItemInScene(scene.fullImageUrl, detail.itemName);
        if (newBox) {
          detail.box_2d = newBox;
        }
      }
    }));
  }

  return bestResponse;
};
