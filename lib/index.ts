import * as fs from 'fs';
import * as path from 'path';
import { OpenAPIObject } from 'openapi3-ts';
import { s2o, fixSwagger, fixOpenAPI, requestData, CommonError } from './util';
import { ServiceGenerator, GenConfig } from './ServiceGenerator';

export class CliConfig extends GenConfig {
  api?: string;
  saveOpenAPIData?: boolean;
  autoClear?: boolean = true;
  /** 自动清除旧文件时忽略列表 */
  ignoreDelete?: string[] = [];
}

export async function genSDK(cfg: string | CliConfig | CliConfig[]) {
  let configs: CliConfig[] = [];

  [].concat(cfg).forEach(c => {
    if (typeof c === 'string') {
      let cfgData = require(c);
      if ((configs as any).__esModule) {
        cfgData = (configs as any).default;
      }
      configs.push(...[].concat(cfgData));
    } else if (typeof c === 'object') {
      configs.push(c);
    } else {
      throw new CommonError(`fail load config: ${c}`);
    }
  });

  return Promise.all(
    configs.map(cfg => {
      cfg = {
        ...new CliConfig(),
        ...cfg,
      };
      cfg.sdkDir = getAbsolutePath(cfg.sdkDir);
      cfg.interfaceTemplatePath = getAbsolutePath(cfg.interfaceTemplatePath);
      cfg.templatePath = getAbsolutePath(cfg.templatePath);
      return genFromUrl(cfg);
    })
  );
}

export async function genFromData(config: CliConfig, data: OpenAPIObject) {
  config = {
    ...new CliConfig(),
    ...config,
  };

  if (!data || !data.paths || !data.info) {
    throw new CommonError(`数据格式不正确 ${config.api}`);
  }

  mkdir(config.sdkDir);

  if (config.saveOpenAPIData) {
    fs.writeFileSync(
      path.join(config.sdkDir, 'origin.json'),
      JSON.stringify(data, null, 2),
      'utf8'
    );
  }

  if (data.swagger === '2.0') {
    data = await convertSwagger2OpenAPI(data);
  } else {
    fixOpenAPI(data);
  }

  if (!data.openapi || !data.openapi.startsWith('3.')) {
    throw new CommonError('数据格式不正确，仅支持 OpenAPI 3.0/Swagger 2.0');
  }

  if (config.autoClear && fs.existsSync(config.sdkDir)) {
    fs.readdirSync(config.sdkDir).forEach(file => {
      if (
        !['d.ts', '.ts', '.js'].some(ext => path.extname(file) === ext) ||
        (config.requestLib && file.startsWith('base.'))
      ) {
        return;
      }
      const absoluteFilePath = path.join(config.sdkDir, '/', file);
      if ((config.ignoreDelete || []).indexOf(file) === -1 && absoluteFilePath !== file) {
        fs.unlinkSync(absoluteFilePath);
      }
    });
  }

  if (config.saveOpenAPIData) {
    fs.writeFileSync(path.join(config.sdkDir, 'oas.json'), JSON.stringify(data, null, 2), 'utf8');
  }

  const generator = new ServiceGenerator(config, data);
  generator.genFile();
}

export async function convertSwagger2OpenAPI(data: OpenAPIObject) {
  fixSwagger(data);
  const tmp = data;
  data = await s2o(data);

  // 每个path增加basePath前缀, 例如swagger api返回 basePath: '/newBasePath'
  if (tmp.basePath && tmp.basePath !== '/') {
    Object.keys(data.paths).forEach(i => {
      data.paths[tmp.basePath + i] = data.paths[i];
      delete data.paths[i];
    });
  }

  fixOpenAPI(data);
  return data;
}

export async function genFromUrl(config: CliConfig) {
  try {
    const data = await JSON.parse(await requestData(config.api));
    return genFromData(config, data);
  } catch (error) {
    console.warn(config.api, error);
    throw error;
  }
}

function getAbsolutePath(filePath: string) {
  return filePath
    ? path.isAbsolute(filePath)
      ? filePath
      : path.join(process.cwd(), filePath)
    : filePath;
}

function mkdir(dir: string) {
  if (!fs.existsSync(dir)) {
    mkdir(path.dirname(dir));
    fs.mkdirSync(dir);
  }
}
