import fs from "fs/promises";
import { PDFParse } from "pdf-parse";
import geminiai from "../config/geminiai.js";
import { pineconeIndex } from "../config/pinecone.js";

function chunkText(text, chunkSize = 500, overlap = 50) {

  if (text.includes("Q:") || text.includes("Q :")) {
    const parts = text.split(/(?=Q\s*:)/i);

    const chunks = [];

    let header = "";

    if (parts.length > 0 && !parts[0].trim().toLowerCase().startsWith("q:")) {
      header = parts.shift().trim();
    }

    for (const part of parts) {
      const trimmed = part.trim();

      if (trimmed) {
        chunks.push(header ? `${header}\n\n${trimmed}` : trimmed);
      }
    }

    if (chunks.length > 0) {
      return chunks;
    }
  }

  // Normal Chunking
  const words = text.split(/\s+/);

  const chunks = [];

  for (let i = 0; i < words.length; i += chunkSize - overlap) {
    chunks.push(words.slice(i, i + chunkSize).join(" "));
  }

  return chunks;
}

export async function uploadDocument(filePath, fileName, category = "general") {
  try {
    console.time("total-upload");

    // ===========================
    // PDF Extraction
    // ===========================

    console.time("pdf-extraction");

    const pdfBuffer = await fs.readFile(filePath);

    const uint8Array = new Uint8Array(
      pdfBuffer.buffer,
      pdfBuffer.byteOffset,
      pdfBuffer.byteLength,
    );

    const parser = new PDFParse(uint8Array);

    const pdfData = await parser.getText();

    const text = pdfData.text;

    console.timeEnd("pdf-extraction");

    if (!text?.trim()) {
      throw new Error("No text extracted from PDF");
    }

    // ===========================
    // Chunking
    // ===========================

    const chunks = chunkText(text);

    console.log(`Total Chunks: ${chunks.length}`);

    // ===========================
    // Embedding
    // ===========================

    console.time("embedding");

    const vectors = [];

    const CONCURRENT_BATCH = 5;

    for (let i = 0; i < chunks.length; i += CONCURRENT_BATCH) {
      const batchChunks = chunks.slice(i, i + CONCURRENT_BATCH);

      const responses = await Promise.all(
        batchChunks.map(async (chunk) => {
          try {
            return await geminiai.models.embedContent({
              model: "gemini-embedding-001",

              contents: chunk,

              config: {
                outputDimensionality: 1024,
              },
            });
          } catch (error) {
            console.error("Embedding Error:", error.message);

            return null;
          }
        }),
      );

      responses.forEach((response, index) => {
        if (!response) return;

        const chunkIndex = i + index;

        const embedding =
          response.embedding?.values || response.embeddings?.[0]?.values;

        if (!embedding) return;

        vectors.push({
          id: `${Date.now()}-${chunkIndex}`,

          values: embedding,

          metadata: {
            source: fileName,

            category,

            chunkIndex,

            text: chunks[chunkIndex],
          },
        });
      });
    }

    console.timeEnd("embedding");

    console.log(`Generated ${vectors.length} embeddings`);

    // ===========================
    // Pinecone Upload
    // ===========================

    console.time("pinecone-upsert");

    const BATCH_SIZE = 100;

    for (let i = 0; i < vectors.length; i += BATCH_SIZE) {
      const batch = vectors.slice(i, i + BATCH_SIZE);

      await pineconeIndex.upsert({
        records: batch,
      });

      console.log(`Uploaded batch ${Math.floor(i / BATCH_SIZE) + 1}`);
    }

    console.timeEnd("pinecone-upsert");

    // ===========================
    // Cleanup
    // ===========================

    try {
      await fs.unlink(filePath);
    } catch (err) {
      console.error("File cleanup failed:", err.message);
    }

    console.timeEnd("total-upload");

    return {
      success: true,
      chunks: vectors.length,
      source: fileName,
      category,
    };
  } catch (error) {
    console.error(error);

    throw error;
  }
}

// import fs from "fs";
// import { PDFParse } from "pdf-parse";
// import geminiai from "../config/geminiai.js";
// import { pineconeIndex } from "../config/pinecone.js";

// function chunkText(text, chunkSize = 500, overlap = 50) {
//   // If the document looks like an FAQ, chunk by Q&A pairs
//   if (text.includes("Q:") || text.includes("Q :")) {
//     const parts = text.split(/(?=Q\s*:)/i);
//     const chunks = [];

//     // Extract the header (e.g., "FAQ Knowledge Base")
//     let header = "";
//     if (parts.length > 0 && !parts[0].trim().toLowerCase().startsWith("q:")) {
//       header = parts.shift().trim();
//     }

//     for (const part of parts) {
//       const trimmed = part.trim();
//       if (trimmed) {
//         // Prepend the header context to give context to the embeddings
//         chunks.push(header ? `${header}\n\n${trimmed}` : trimmed);
//       }
//     }

//     if (chunks.length > 0) {
//       return chunks;
//     }
//   }

//   // Fallback to standard word-based chunking
//   const words = text.split(/\s+/);
//   const chunks = [];

//   for (let i = 0; i < words.length; i += chunkSize - overlap) {
//     chunks.push(
//       words.slice(i, i + chunkSize).join(" ")
//     );
//   }

//   return chunks;
// }

// export async function uploadDocument(
//   filePath,
//   fileName,
//   category
// ) {
//   // Extract PDF text
//   const pdfBuffer = fs.readFileSync(filePath);
//   const uint8Array = new Uint8Array(pdfBuffer.buffer, pdfBuffer.byteOffset, pdfBuffer.byteLength);

//   const parser = new PDFParse(uint8Array);
//   const pdfData = await parser.getText();

//   const text = pdfData.text;

//   // Create chunks
//   const chunks = chunkText(text);

//   const vectors = [];

//   for (let i = 0; i < chunks.length; i++) {

//     const embeddingResponse =
//       await geminiai.models.embedContent({
//         model: "gemini-embedding-001",
//         contents: chunks[i],
//         config: {
//           outputDimensionality: 1024,
//         },
//       });

//     const embedding =
//       embeddingResponse.embedding?.values ||
//       embeddingResponse.embeddings?.[0]?.values;

//     if (!embedding) {
//       throw new Error(`Embedding failed for chunk ${i}`);
//     }
//     // console.log("embedding", embedding)
//     vectors.push({
//       id: `${category}-${fileName}-chunk-${i}`,

//       values: embedding,

//       metadata: {
//         source: fileName,
//         category,
//         chunkIndex: i,
//         text: chunks[i],
//       },

//     });
//   }

// const BATCH_SIZE = 100;

// for (let i = 0; i < vectors.length; i += BATCH_SIZE) {
//   const batch = vectors.slice(i, i + BATCH_SIZE);

//   await pineconeIndex.upsert({
//     records: batch
//   });
// }

//   // Store in Pinecone under the category namespace
// //   await pineconeIndex.namespace(category || "").upsert({ records: vectors });

//   // Remove temp file

// //   fs.unlinkSync(filePath);

//   return {
//     success: true,
//     chunks: vectors.length,
//     source: fileName,
//   };
// }
