import { 
  TFile, 
  TFolder,
  Plugin, 
  WorkspaceLeaf, 
  addIcon, 
  App, 
  PluginManifest, 
  MarkdownView,
  normalizePath,
  MarkdownPostProcessorContext,
} from 'obsidian';
import { 
  BLANK_DRAWING,
  VIEW_TYPE_EXCALIDRAW, 
  EXCALIDRAW_ICON,
  ICON_NAME,
  EXCALIDRAW_FILE_EXTENSION,
  CODEBLOCK_EXCALIDRAW,
  DISK_ICON,
  DISK_ICON_NAME,
  PNG_ICON,
  PNG_ICON_NAME,
  SVG_ICON,
  SVG_ICON_NAME,
  RERENDER_EVENT
} from './constants';
import ExcalidrawView, {ExportSettings} from './ExcalidrawView';
import {
  ExcalidrawSettings, 
  DEFAULT_SETTINGS, 
  ExcalidrawSettingTab
} from './settings';
import {
  openDialogAction, 
  OpenFileDialog
} from './openDrawing';


export default class ExcalidrawPlugin extends Plugin {
  public settings: ExcalidrawSettings;
  private openDialog: OpenFileDialog;
  
  constructor(app: App, manifest: PluginManifest) {
    super(app, manifest);
  }
  
  async onload() {
    addIcon(ICON_NAME, EXCALIDRAW_ICON);
    addIcon(DISK_ICON_NAME,DISK_ICON);
    addIcon(PNG_ICON_NAME,PNG_ICON);
    addIcon(SVG_ICON_NAME,SVG_ICON);

    this.registerView(
      VIEW_TYPE_EXCALIDRAW, 
      (leaf: WorkspaceLeaf) => new ExcalidrawView(leaf, this)
    );

    this.registerExtensions([EXCALIDRAW_FILE_EXTENSION],VIEW_TYPE_EXCALIDRAW);

    this.registerMarkdownCodeBlockProcessor(CODEBLOCK_EXCALIDRAW, async (source,el,ctx) => {
      el.addEventListener(RERENDER_EVENT,async (e) => {
        e.stopPropagation();
        el.empty();
        this.codeblockProcessor(source,el,ctx,this);
      });
      this.codeblockProcessor(source,el,ctx,this);
    }); 

    await this.loadSettings();
    this.addSettingTab(new ExcalidrawSettingTab(this.app, this));

    this.openDialog = new OpenFileDialog(this.app, this);
    this.addRibbonIcon(ICON_NAME, 'Create a new drawing in Excalidraw', async (e) => {
      this.createDrawing(this.getNextDefaultFilename(), e.ctrlKey);
    });

    this.addCommand({
      id: "excalidraw-open",
      name: "Open an existing drawing - IN A NEW PANE",
      callback: () => {
        this.openDialog.start(openDialogAction.openFile, true);
      },
    });


    this.addCommand({
      id: "excalidraw-open-on-current",
      name: "Open an existing drawing - IN THE CURRENT ACTIVE PANE",
      callback: () => {
        this.openDialog.start(openDialogAction.openFile, false);
      },
    });

    this.addCommand({
      id: "excalidraw-insert-transclusion",
      name: "Transclude (embed) an ."+EXCALIDRAW_FILE_EXTENSION+" drawing",
      checkCallback: (checking: boolean) => {
        if (checking) {
          return this.app.workspace.activeLeaf.view.getViewType() == "markdown";
        } else {
          this.openDialog.start(openDialogAction.insertLink, false);
          return true;
        }
      },
    });

    this.addCommand({
      id: "excalidraw-autocreate",
      name: "Create a new drawing - IN A NEW PANE",
      callback: () => {
        this.createDrawing(this.getNextDefaultFilename(), true);
      },
    });

    this.addCommand({
      id: "excalidraw-autocreate-on-current",
      name: "Create a new drawing - IN THE CURRENT ACTIVE PANE",
      callback: () => {
        this.createDrawing(this.getNextDefaultFilename(), false);
      },
    });

    this.addCommand({
      id: 'export-svg',
      name: 'Export SVG. Save it next to the current file',
      checkCallback: (checking: boolean) => {
        if (checking) {
          return this.app.workspace.activeLeaf.view.getViewType() == VIEW_TYPE_EXCALIDRAW;
        } else {
          const view = this.app.workspace.activeLeaf.view;
          if(view.getViewType() == VIEW_TYPE_EXCALIDRAW) {
            (this.app.workspace.activeLeaf.view as ExcalidrawView).saveSVG();
            return true;
          }
          else return false;
        }
      },
    });

    this.addCommand({
      id: 'export-png',
      name: 'Export PNG. Save it next to the current file',
      checkCallback: (checking: boolean) => {
        if (checking) {
          return this.app.workspace.activeLeaf.view.getViewType() == VIEW_TYPE_EXCALIDRAW;
        } else {
          const view = this.app.workspace.activeLeaf.view;
          if(view.getViewType() == VIEW_TYPE_EXCALIDRAW) {
            (this.app.workspace.activeLeaf.view as ExcalidrawView).savePNG();
            return true;
          }
          else return false;
        }
      },
    });
    //watch filename change to rename .svg
    this.app.vault.on('rename',async (file,oldPath) => {
      if (!(this.settings.keepInSync  && file instanceof TFile)) return;
      if (file.extension != EXCALIDRAW_FILE_EXTENSION) return;
      const oldSVGpath = oldPath.substring(0,oldPath.lastIndexOf('.'+EXCALIDRAW_FILE_EXTENSION)) + '.svg'; 
      const svgFile = this.app.vault.getAbstractFileByPath(normalizePath(oldSVGpath));
      if(svgFile && svgFile instanceof TFile) {
        const newSVGpath = file.path.substring(0,file.path.lastIndexOf('.'+EXCALIDRAW_FILE_EXTENSION)) + '.svg';
        await this.app.vault.rename(svgFile,newSVGpath); 
      }
    });

    //watch file delete and delete corresponding .svg
    this.app.vault.on('delete',async (file:TFile) => {
      if (!(this.settings.keepInSync  && file instanceof TFile)) return;
      if (file.extension != EXCALIDRAW_FILE_EXTENSION) return;
      const svgPath = file.path.substring(0,file.path.lastIndexOf('.'+EXCALIDRAW_FILE_EXTENSION)) + '.svg'; 
      const svgFile = this.app.vault.getAbstractFileByPath(normalizePath(svgPath));
      if(svgFile && svgFile instanceof TFile) {
        await this.app.vault.delete(svgFile); 
      }
    });
  }
  
  private async codeblockProcessor(source: string, el: HTMLElement, ctx: MarkdownPostProcessorContext, plugin: ExcalidrawPlugin) {
    const parseError = (message: string) => {
      el.createDiv("excalidraw-error",(el)=> {
        el.createEl("p","Please provide a link to an excalidraw file: [[file."+EXCALIDRAW_FILE_EXTENSION+"]]");
        el.createEl("p",message);
        el.createEl("p",source);
      })  
    }

    const parts = source.match(/\[{2}([^|]*)\|?(\d*)x?(\d*)\|?(.*)\]{2}/m);
    if(!parts) {
      parseError("No link to file found in codeblock.");
      return;
    }
    const fname = parts[1];
    const fwidth = parts[2]? parts[2] : plugin.settings.width;
    const fheight = parts[3];
    const style = "excalidraw-svg" + (parts[4] ? "-" + parts[4] : "");

    if(!fname) {
      parseError("No link to file found in codeblock.");
      return;
    }

    const file = plugin.app.vault.getAbstractFileByPath(fname);
    if(!(file && file instanceof TFile)) {
      parseError("File does not exist. " + fname);
      return;
    }

    if(file.extension != EXCALIDRAW_FILE_EXTENSION) {
      parseError("Not an excalidraw file. Must have extension " + EXCALIDRAW_FILE_EXTENSION);
      return;
    }

    const content = await plugin.app.vault.read(file);
    const exportSettings: ExportSettings = {
      withBackground: plugin.settings.exportWithBackground, 
      withTheme: plugin.settings.exportWithTheme
    }
    const svg = ExcalidrawView.getSVG(content,exportSettings);
    if(!svg) {
      parseError("Parse error. Not a valid Excalidraw file.");
      return;
    }
    el.createDiv(style,(el)=> {
      svg.removeAttribute('width');
      svg.removeAttribute('height');
      svg.style.setProperty('width',fwidth);
      if(fheight) svg.style.setProperty('height',fheight);
      svg.addClass(style);
      el.appendChild(svg);
    });
  }

  public insertCodeblock(data:string) {
    const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
    if(activeView) {
      const editor = activeView.editor;
      editor.replaceSelection(
        String.fromCharCode(96,96,96) + 
        CODEBLOCK_EXCALIDRAW +
        "\n[["+data+"]]\n" +
        String.fromCharCode(96,96,96));
      editor.focus();
    }
  
  }

  private async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  public triggerEmbedUpdates(){
    const e = document.createEvent("Event")
    e.initEvent(RERENDER_EVENT,true,false);
    document
      .querySelectorAll("svg[class^='excalidraw-svg']")
      .forEach((el) => el.dispatchEvent(e));
  }

  public async openDrawing(drawingFile: TFile, onNewPane: boolean) {
    const leafs = this.app.workspace.getLeavesOfType(VIEW_TYPE_EXCALIDRAW);
    let leaf:WorkspaceLeaf = null;

    if (leafs?.length > 0) {
      leaf = leafs[0];
    }
    if(!leaf) {
      leaf = this.app.workspace.activeLeaf;
    }

    if(!leaf) {
      leaf = this.app.workspace.getLeaf();
    }
    
    if(onNewPane) {
      leaf = this.app.workspace.createLeafBySplit(leaf);
    }    

    leaf.setViewState({
      type: VIEW_TYPE_EXCALIDRAW,
      state: {file: drawingFile.path}}
    );
  }

  private getNextDefaultFilename():string {
    return this.settings.folder+'/Drawing ' + window.moment().format('YYYY-MM-DD HH.mm.ss')+'.'+EXCALIDRAW_FILE_EXTENSION;
  }
 
  public async createDrawing(filename: string, onNewPane: boolean) {
    const folder = this.app.vault.getAbstractFileByPath(normalizePath(this.settings.folder));
    if (!(folder && folder instanceof TFolder)) {
      await this.app.vault.createFolder(this.settings.folder);
    }

    const file = this.app.vault.getAbstractFileByPath(normalizePath(this.settings.templateFilePath));
    if(file && file instanceof TFile) {
      const content = await this.app.vault.read(file);
      this.openDrawing(await this.app.vault.create(filename,content==''?BLANK_DRAWING:content), onNewPane);
    } else {
      this.openDrawing(await this.app.vault.create(filename,BLANK_DRAWING), onNewPane);
    }
  }
}