import * as fs from 'fs';
import * as path from 'path';

export class InjectManager {
  private static cachedContent: string | null = null;
  private static readonly injectDir = path.join(process.cwd(), 'core', 'load');

  static getInjectedContent(): string {
    if (this.cachedContent !== null) return this.cachedContent;

    if (!fs.existsSync(this.injectDir)) return '';

    const files = fs.readdirSync(this.injectDir).filter(file => file.endsWith('.md'));
    
    this.cachedContent = files.map(file => {
      return fs.readFileSync(path.join(this.injectDir, file), 'utf-8');
    }).join('\n\n');
    
    return this.cachedContent;
  }
}
