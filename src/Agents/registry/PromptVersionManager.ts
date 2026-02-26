import { AppDataSource } from "../../config/Datasource";
import { PromptVersion } from "./PromptVersion.entity";
import { promptVersionService } from "./PromptVersionService";

export class PromptVersionManager {
  private repo = AppDataSource.getRepository(PromptVersion);

  async createVersion(
    name: string,
    type: string,
    content: string,
    version: string,
    weight = 50
  ): Promise<PromptVersion> {
    const prompt = this.repo.create({
      name,
      type,
      content,
      version,
      weight,
      isActive: false,
    });
    return await this.repo.save(prompt);
  }

  async activateVersion(id: string): Promise<void> {
    await this.repo.update({ id }, { isActive: true });
  }

  async deactivateVersion(id: string): Promise<void> {
    await this.repo.update({ id }, { isActive: false });
  }

  async updateWeight(id: string, weight: number): Promise<void> {
    await this.repo.update({ id }, { weight });
  }

  async listVersions(type?: string) {
    const where = type ? { type } : {};
    const versions = await this.repo.find({ where });

    for (const version of versions) {
      const metrics = await promptVersionService.getMetrics(version.id);
      console.log({
        id: version.id,
        name: version.name,
        type: version.type,
        version: version.version,
        isActive: version.isActive,
        weight: version.weight,
        metrics,
      });
    }
  }

  async compareVersions(id1: string, id2: string) {
    const [metrics1, metrics2] = await Promise.all([
      promptVersionService.getMetrics(id1),
      promptVersionService.getMetrics(id2),
    ]);

    return {
      version1: { id: id1, ...metrics1 },
      version2: { id: id2, ...metrics2 },
      winner:
        metrics1.successRate > metrics2.successRate ? "version1" : "version2",
    };
  }
}

export const promptVersionManager = new PromptVersionManager();
