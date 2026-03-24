/**
 * 书签工具函数
 * 封装所有与 chrome.bookmarks API 的交互逻辑
 */

/**
 * 递归遍历书签树，扁平化为书签列表（不含文件夹节点）
 * @param {chrome.bookmarks.BookmarkTreeNode[]} nodes
 * @param {string} [parentPath=''] - 父文件夹路径
 * @returns {Array<Object>} 扁平化书签列表
 */
export function flattenBookmarks(nodes, parentPath = '') {
  const result = [];
  for (const node of nodes) {
    const currentPath = parentPath ? `${parentPath}/${node.title}` : node.title;
    if (node.url) {
      // 叶子节点：书签
      result.push({
        browserId: node.id,
        title: node.title,
        url: node.url,
        folderPath: parentPath || '/',
        dateAdded: node.dateAdded,
        dateLastUsed: node.dateLastUsed || node.dateAdded,
      });
    } else if (node.children) {
      // 文件夹节点：递归处理子节点
      result.push(...flattenBookmarks(node.children, currentPath));
    }
  }
  return result;
}

/**
 * 获取所有浏览器书签（扁平化列表）
 * @returns {Promise<Array<Object>>}
 */
export async function getAllBookmarks() {
  const tree = await chrome.bookmarks.getTree();
  return flattenBookmarks(tree);
}

/**
 * 根据文件夹路径，确保浏览器中存在对应的文件夹，返回文件夹 ID
 * @param {string} folderPath - 如 '/工作/前端'
 * @returns {Promise<string>} 文件夹节点 ID
 */
export async function ensureFolderPath(folderPath) {
  const parts = folderPath.replace(/^\//, '').split('/').filter(Boolean);
  if (parts.length === 0) {
    // 根目录，使用"书签栏"
    const tree = await chrome.bookmarks.getTree();
    return tree[0].children[0].id; // 书签栏
  }

  let parentId = '1'; // 书签栏 ID
  for (const part of parts) {
    const children = await chrome.bookmarks.getChildren(parentId);
    const existing = children.find((c) => !c.url && c.title === part);
    if (existing) {
      parentId = existing.id;
    } else {
      const newFolder = await chrome.bookmarks.create({ parentId, title: part });
      parentId = newFolder.id;
    }
  }
  return parentId;
}

/**
 * 在浏览器中创建书签
 * @param {{ title: string, url: string, folderPath: string }} bookmark
 * @returns {Promise<chrome.bookmarks.BookmarkTreeNode>}
 */
export async function createBookmark({ title, url, folderPath }) {
  const parentId = await ensureFolderPath(folderPath);
  return chrome.bookmarks.create({ parentId, title, url });
}
