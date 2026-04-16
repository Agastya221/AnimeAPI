import fs from "fs";
import path from "path";

export const DOC_SECTIONS = ["intro", "maintenance", "endpoints"] as const;
export type DocSection = (typeof DOC_SECTIONS)[number];

export type EndpointDoc = {
    method?: string;
    path?: string;
    query?: string[];
    description?: string;
};

export type EndpointCatalog = {
    generatedAt?: string;
    service?: string;
    base?: {
        compat?: string;
        proxy?: string;
        v2?: string;
    };
    system?: EndpointDoc[];
    compatibility?: EndpointDoc[];
    proxy?: EndpointDoc[];
    v2?: {
        hianime?: EndpointDoc[];
        other?: EndpointDoc[];
    };
    providers?: {
        mount?: string;
        catalog?: EndpointDoc[];
    };
};

export const readDocSection = (section: DocSection) => {
    const docsDir = path.join(process.cwd(), "src", "docs");
    return fs.readFileSync(path.join(docsDir, `${section}.md`), "utf-8");
};

const getEndpointsCatalogPath = () => {
    const candidates = [
        path.join(process.cwd(), "endpoints", "endpoints.json"),
        path.join(process.cwd(), "endpoints.json"),
    ];
    const filePath = candidates.find((candidate) => fs.existsSync(candidate));

    if (!filePath) {
        throw new Error("Endpoint catalog not found");
    }

    return filePath;
};

export const readEndpointsCatalog = (): EndpointCatalog => {
    const raw = fs.readFileSync(getEndpointsCatalogPath(), "utf-8");
    return JSON.parse(raw) as EndpointCatalog;
};

const formatEndpointLine = (endpoint: EndpointDoc) => {
    const query =
        Array.isArray(endpoint.query) && endpoint.query.length > 0
            ? ` (query: ${endpoint.query.join(", ")})`
            : "";
    const description = endpoint.description
        ? ` - ${endpoint.description}`
        : "";

    return `- ${endpoint.method || "GET"} ${endpoint.path || ""}${query}${description}`;
};

export const buildEndpointsMarkdown = () => {
    const data = readEndpointsCatalog();

    const lines: string[] = [];
    lines.push("# TatakaiCore Endpoint Catalog");
    lines.push("");
    lines.push(`Generated: ${data.generatedAt || "unknown"}`);
    lines.push("");
    lines.push("## System");
    lines.push("");
    for (const endpoint of data.system || []) {
        lines.push(formatEndpointLine(endpoint));
    }
    lines.push("");
    lines.push("## Compatibility");
    lines.push("");
    for (const endpoint of data.compatibility || []) {
        lines.push(formatEndpointLine(endpoint));
    }
    lines.push("");
    lines.push("## Proxy");
    lines.push("");
    for (const endpoint of data.proxy || []) {
        lines.push(formatEndpointLine(endpoint));
    }
    lines.push("");
    lines.push("## V2 HiAnime");
    lines.push("");
    for (const endpoint of data.v2?.hianime || []) {
        lines.push(formatEndpointLine(endpoint));
    }
    lines.push("");
    lines.push("## V2 Other");
    lines.push("");
    for (const endpoint of data.v2?.other || []) {
        lines.push(formatEndpointLine(endpoint));
    }
    lines.push("");
    lines.push("## Providers (/api/v2/anime)");
    lines.push("");
    for (const endpoint of data.providers?.catalog || []) {
        lines.push(formatEndpointLine(endpoint));
    }
    lines.push("");
    lines.push("Machine-readable source: /api/v2/docs/endpoints-json");

    return lines.join("\n");
};
