import fs from "fs/promises";
import { PDFParse } from "pdf-parse";
import geminiai from "../config/geminiai.js";
import { pineconeIndex } from "../config/pinecone.js";
import prisma from "../config/prisma.js";

function chunkText(text, chunkSize = 500, overlap = 50) {
  // Ensure chunkSize is a positive integer
  chunkSize = Math.max(1, Math.floor(chunkSize));
  // Ensure overlap is non-negative and strictly less than chunkSize to prevent infinite loops
  if (overlap >= chunkSize || overlap < 0) {
    overlap = Math.floor(chunkSize * 0.1);
  }

  if (/Q\s*\d*\s*:/i.test(text)) {
    const parts = text.split(/(?=Q\s*\d*\s*:)/i);

    const chunks = [];

    let header = "";

    if (parts.length > 0 && !/^Q\s*\d*\s*:/i.test(parts[0].trim())) {
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

  const step = chunkSize - overlap;

  for (let i = 0; i < words.length; i += step) {
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
          id: `${fileName}-${chunkIndex}`,

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
    // PostgreSQL Storage
    // ===========================
    console.time("postgres-upsert");
    try {
      // Clear existing chunks for this source and category to avoid duplicates/stale data
      await prisma.documentChunk.deleteMany({
        where: {
          source: fileName,
          category: category || "general",
        },
      });

      // Bulk insert the new chunks
      await prisma.documentChunk.createMany({
        data: vectors.map((v) => ({
          id: v.id,
          text: v.metadata.text,
          source: v.metadata.source,
          category: v.metadata.category,
          chunkIndex: v.metadata.chunkIndex,
        })),
        skipDuplicates: true,
      });
      console.log(`Saved ${vectors.length} chunks to PostgreSQL.`);
    } catch (dbError) {
      console.error("Error saving chunks to PostgreSQL:", dbError);
      throw dbError;
    }
    console.timeEnd("postgres-upsert");

    // ===========================
    // Pinecone Upload
    // ===========================

    console.time("pinecone-upsert");

    const BATCH_SIZE = 10;

    for (let i = 0; i < vectors.length; i += BATCH_SIZE) {
      const batch = vectors.slice(i, i + BATCH_SIZE);

      await pineconeIndex.namespace(category || "general").upsert({
        records: batch,
      });

      console.log(`Uploaded batch ${Math.floor(i / BATCH_SIZE) + 1}`);
    }

    console.timeEnd("pinecone-upsert");

    // ===========================
    // Cleanup
    // ===========================

    // try {
    //   await fs.unlink(filePath);
    // } catch (err) {
    //   console.error("File cleanup failed:", err.message);
    // }

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

export async function deleteDocument(fileName, category) {
  try {
    console.log(`Starting deletion for document: ${fileName}`);

    // 1. Identify which namespaces (categories) this document's chunks exist in, in PostgreSQL
    let categories = [];
    if (category) {
      categories = [category];
    } else {
      const distinctChunks = await prisma.documentChunk.findMany({
        where: { source: fileName },
        select: { category: true },
        distinct: ["category"],
      });
      categories = distinctChunks.map((c) => c.category || "general");
    }

    if (categories.length === 0) {
      categories = ["general"];
    }

    // 2. Delete vectors from Pinecone for each namespace
    for (const ns of categories) {
      try {
        await pineconeIndex.namespace(ns).deleteMany({
          filter: { source: { $eq: fileName } },
        });
        console.log(`Deleted vectors from Pinecone namespace: ${ns}`);
      } catch (pineconeErr) {
        console.error(`Error deleting vectors from Pinecone namespace ${ns}:`, pineconeErr.message);
      }
    }

    // 3. Clean up empty Pinecone namespaces (0 records left)
    try {
      const stats = await pineconeIndex.describeIndexStats();
      for (const ns of categories) {
        const nsStats = stats.namespaces?.[ns];
        if (nsStats && nsStats.recordCount === 0) {
          console.log(`Namespace "${ns}" has 0 records. Deleting empty namespace from Pinecone.`);
          try {
            await pineconeIndex.deleteNamespace(ns);
            console.log(`Successfully deleted empty Pinecone namespace: ${ns}`);
          } catch (deleteNsErr) {
            console.warn(`deleteNamespace failed for "${ns}", trying deleteAll fallback:`, deleteNsErr.message);
            try {
              await pineconeIndex.namespace(ns).deleteAll();
              console.log(`Successfully ran deleteAll on empty namespace: ${ns}`);
            } catch (deleteAllErr) {
              console.error(`Could not clean up empty namespace "${ns}":`, deleteAllErr.message);
            }
          }
        }
      }
    } catch (statsErr) {
      console.error("Error reading index statistics for namespace cleanup:", statsErr.message);
    }

    // 4. Delete chunks from PostgreSQL database
    const dbDeleteResult = await prisma.documentChunk.deleteMany({
      where: { source: fileName },
    });
    console.log(`Deleted ${dbDeleteResult.count} chunks from PostgreSQL database.`);

    // 4. Delete the file from the uploads directory
    const localFilePath = `./uploads/${fileName}`;
    try {
      await fs.unlink(localFilePath);
      console.log(`Deleted local file: ${localFilePath}`);
    } catch (fsErr) {
      if (fsErr.code === 'ENOENT') {
        console.log(`Local file ${localFilePath} not found, skipping file cleanup.`);
      } else {
        console.error(`Error deleting local file ${localFilePath}:`, fsErr.message);
      }
    }

    return {
      success: true,
      message: `Document ${fileName} deleted successfully.`,
      databaseChunksDeleted: dbDeleteResult.count,
      namespacesCleaned: categories,
    };
  } catch (error) {
    console.error(`Error during deleteDocument for ${fileName}:`, error);
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
//       id: `${fileName}-${chunkIndex}`,

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
