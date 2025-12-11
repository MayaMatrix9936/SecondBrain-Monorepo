from fastapi import FastAPI
from pydantic import BaseModel
import chromadb

app = FastAPI()

# NEW Chroma client (v0.5+)
client = chromadb.PersistentClient(path="/data")

class UpsertItem(BaseModel):
    id: str
    embedding: list[float]
    metadata: dict | None = None
    document: str | None = None

class UpsertRequest(BaseModel):
    collection: str
    items: list[UpsertItem]

class QueryRequest(BaseModel):
    collection: str
    query_embedding: list[float]
    n_results: int = 5

@app.post("/upsert")
def upsert(req: UpsertRequest):
    col = client.get_or_create_collection(
        name=req.collection,
        metadata={"hnsw:space": "cosine"}   # recommended default
    )

    ids = [i.id for i in req.items]
    embeddings = [i.embedding for i in req.items]
    documents = [i.document for i in req.items]
    metadatas = [i.metadata for i in req.items]

    col.add(
        ids=ids,
        embeddings=embeddings,
        metadatas=metadatas,
        documents=documents
    )

    return {"ok": True, "count": len(ids)}

@app.post("/query")
def query(req: QueryRequest):
    col = client.get_or_create_collection(name=req.collection)

    results = col.query(
        query_embeddings=[req.query_embedding],
        n_results=req.n_results
    )

    formatted = []
    for i, id in enumerate(results["ids"][0]):
        formatted.append({
            "id": id,
            "distance": results["distances"][0][i],
            "document": results["documents"][0][i],
            "metadata": results["metadatas"][0][i]
        })
    return {"results": formatted}

class DeleteRequest(BaseModel):
    collection: str
    ids: list[str]

@app.post("/delete")
def delete_items(req: DeleteRequest):
    try:
        col = client.get_or_create_collection(name=req.collection)
        col.delete(ids=req.ids)
        return {"ok": True, "deleted": len(req.ids)}
    except Exception as e:
        return {"ok": False, "error": str(e)}

@app.get("/health")
@app.get("/")
def health():
    return {"ok": True, "service": "chroma"}
