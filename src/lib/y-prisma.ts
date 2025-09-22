import { PrismaClient } from '@prisma/client';
import * as Y from 'yjs';
import { Awareness } from 'y-protocols/awareness';

const prisma = new PrismaClient();

function toBuffer(arr: Uint8Array): Buffer {
    return Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength);
}

function toUint8Array(buf: Buffer): Uint8Array {
    // Buffer is already a Uint8Array in Node.js, just need to ensure proper type
    return new Uint8Array(buf);
}

export class PrismaPersistence {
    public async getYDoc(docName: string): Promise<Y.Doc> {
        const ydoc = new Y.Doc();
        
        const dbDoc = await prisma.yjsDocument.findUnique({
            where: { pageId: docName },
            include: { updates: { orderBy: { createdAt: 'asc' } } }
        });

        if (dbDoc) {
            // Cast Buffer to Uint8Array properly
            const docData = new Uint8Array(dbDoc.data);
            Y.applyUpdate(ydoc, docData);
            for (const update of dbDoc.updates) {
                const updateData = new Uint8Array(update.data);
                Y.applyUpdate(ydoc, updateData);
            }
        } else {
            const initialState = Y.encodeStateAsUpdate(ydoc);
            await prisma.yjsDocument.create({
                data: {
                    pageId: docName,
                    data: toBuffer(initialState),
                }
            });
        }
        
        return ydoc;
    }

    public async storeUpdate(docName: string, update: Uint8Array): Promise<void> {
        let dbDoc = await prisma.yjsDocument.findUnique({
            where: { pageId: docName }
        });

        if (!dbDoc) {
            await this.getYDoc(docName);
            dbDoc = await prisma.yjsDocument.findUnique({ where: { pageId: docName } });
            if (!dbDoc) {
                throw new Error(`[y-prisma] Could not find or create document for page: ${docName}`);
            }
        }
        
        await prisma.yjsUpdate.create({
            data: {
                documentId: dbDoc.id,
                data: toBuffer(update)
            }
        });
    }

    public async flushDocument(docName: string): Promise<void> {
        const ydoc = await this.getYDoc(docName);
        const newDocState = Y.encodeStateAsUpdate(ydoc);

        const dbDoc = await prisma.yjsDocument.findUnique({
            where: { pageId: docName },
        });

        if (!dbDoc) {
            return;
        }

        await prisma.$transaction([
            prisma.yjsDocument.update({
                where: { id: dbDoc.id },
                data: { data: toBuffer(newDocState) }
            }),
            prisma.yjsUpdate.deleteMany({
                where: { documentId: dbDoc.id }
            })
        ]);
    }

    public getAwareness(docName: string): Awareness | null {
        return null;
    }

    public clearAwareness(docName: string): void {}
    
    public setAwareness(docName: string, awareness: Awareness): void {}
}
