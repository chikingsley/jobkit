import { writeFile } from "node:fs/promises";
import { join } from "node:path";

export interface StructuredAgentArtifact {
  bytes: Uint8Array;
  contentType: string;
  filename: string;
}

export async function prepareArtifactImages(
  directory: string,
  artifacts: StructuredAgentArtifact[]
) {
  const imageGroups = await Promise.all(
    artifacts.map(async (artifact, artifactIndex) => {
      if (artifact.contentType === "application/pdf") {
        return renderPdfArtifact(directory, artifact.bytes, artifactIndex);
      }
      const extension = imageExtension(artifact.contentType);
      if (!extension) {
        throw new Error(
          `Agent vision does not accept ${artifact.contentType} artifacts`
        );
      }
      const imagePath = join(
        directory,
        `artifact-${String(artifactIndex + 1).padStart(3, "0")}.${extension}`
      );
      await writeFile(imagePath, artifact.bytes);
      return [imagePath];
    })
  );
  return imageGroups.flat();
}

async function renderPdfArtifact(
  directory: string,
  bytes: Uint8Array,
  artifactIndex: number
) {
  const { definePDFJSModule, getDocumentProxy, renderPageAsImage } =
    await import("unpdf");
  await definePDFJSModule(() => import("pdfjs-dist/legacy/build/pdf.mjs"));
  const document = await getDocumentProxy(bytes);
  const imagePaths: string[] = [];
  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    // biome-ignore lint/performance/noAwaitInLoops: Ordered page rendering bounds peak memory and preserves document order.
    const image = await renderPageAsImage(document, pageNumber, {
      canvasImport: () => import("@napi-rs/canvas"),
      scale: 1.5,
    });
    const imagePath = join(
      directory,
      `artifact-${String(artifactIndex + 1).padStart(3, "0")}-page-${String(pageNumber).padStart(3, "0")}.png`
    );
    await writeFile(imagePath, new Uint8Array(image));
    imagePaths.push(imagePath);
  }
  return imagePaths;
}

function imageExtension(contentType: string) {
  switch (contentType) {
    case "image/jpeg":
      return "jpg";
    case "image/png":
      return "png";
    case "image/webp":
      return "webp";
    default:
      return null;
  }
}
