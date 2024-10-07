/*
 * @Author: Kabuda-czh
 * @LastEditors: Kabuda-czh
 * @FilePath: \koishi-plugin-dbm\src\index.ts
 * @Description:
 *
 * Copyright (c) 2023 by Kabuda-czh, All Rights Reserved.
 */

import { Context, Schema, Logger } from 'koishi';
import fs from 'fs';
import path from 'path';

export const name = 'dbm';
export const usage = `备份的数据库文件在./data/dbm\n
一些表名含有大写字母会导致无法自动备份，需要把这些表名填入配置项中`;
export const logger = new Logger(name);

export const inject = {
    required: ['database'],
};

export interface Config {
    tables: string[];
}

export const Config = Schema.object({
    tables: Schema.array(String).description('含有大写字母的表名').default([]),
});

function initDirPath(dirPath: string) {
    if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
    }
}

async function backup(dirPath: string, table: string, rows: any) {
    // 使用原始表名作为文件名
    const tablePath = path.join(dirPath, table);
    await fs.promises.writeFile(tablePath, JSON.stringify(rows, null, 2));
}

async function recover(dirPath: string, table: string) {
    const tablePath = path.join(dirPath, table);
    if (!fs.existsSync(tablePath)) {
        return false;
    }
    const rows = JSON.parse(await fs.promises.readFile(tablePath, 'utf-8'), (key, value) => {
        if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z$/.test(value)) {
            return new Date(value);
        }
        return value;
    });
    return rows;
}

export async function apply(ctx: Context, cfg: Config): Promise<void> {
    const backupDirPath = './data/dbm';

    ctx.command('备份db', '', { authority: 4 }).action(async () => {
        try {
            initDirPath(backupDirPath);
            const dbStats = await ctx.database.stats();
            const tables = Object.keys(dbStats.tables).concat(cfg.tables);
            const bkps = await Promise.all(tables.map(async (table) => {
                try {
                    // @ts-ignore
                    const rows = await ctx.database.get(table, {});
                    await backup(backupDirPath, table, rows);
                    return table;
                } catch (e) {
                    logger.warn(`备份 ${table} 失败：${e.message}`);
                }
            }));
            const successBkps = bkps.filter((table) => table !== undefined);
            if (successBkps.length > 0) {
                logger.info(`已备份 ${successBkps.join('，')}`);
                return `已备份 ${successBkps.join('，')}`;
            } else {
                logger.warn('备份失败，请查看日志');
                return '备份失败，请查看日志';
            }
        } catch (e) {
            logger.warn(`备份失败：${e.message}`);
            return '备份失败，请查看日志';
        }
    });

    ctx.command('恢复db', '', { authority: 4 }).action(async () => {
        try {
            const tables = await fs.promises.readdir(backupDirPath);
            const bkps = await Promise.all(tables.map(async (table) => {
                try {
                    const rows = await recover(backupDirPath, table);
                    if (rows) {
                        // @ts-ignore
                        await ctx.database.upsert(table, rows);
                        return table;
                    }
                } catch (e) {
                    logger.warn(`恢复 ${table} 失败：${e.message}`);
                }
            }));
            const successRcvs = bkps.filter((table) => table !== undefined);
            if (successRcvs.length > 0) {
                logger.info(`已恢复 ${successRcvs.join('，')}`);
                return `已恢复 ${successRcvs.join('，')}`;
            } else {
                logger.warn('恢复失败，请查看日志');
                return '恢复失败，请查看日志';
            }
        } catch (e) {
            logger.warn(`恢复失败：${e.message}`);
            return '恢复失败，请查看日志';
        }
    });
}
