import { describe, it, expect, vi } from 'vitest';
import { ContextRepository, ContextRepositoryFactory } from '../../../src/repositories/context';

const configMock = vi.hoisted(() => ({
  config: {
    PERSONAL_INFORMATION: {
      name: 'Test User',
      gender: 'female',
      birthday: '1990-01-01',
      location: 'SP',
      occupation: 'Engineer',
      favorite_food: 'Pizza',
    },
  },
}));

vi.mock('../../../src/config', () => configMock);

describe('ContextRepository', () => {
  it('formats channel, platform and personal information into a prompt', () => {
    const repository = new ContextRepository();

    const result = repository.get({ channel: 'telegram' });

    expect(result).toContain('# Before responding, consider the following context information:');
    expect(result).toContain('1. Datetime:');
    expect(result).toContain('2. Channel Source: telegram');
    expect(result).toContain('3. Platform:');
    expect(result).toContain('4. Main Human Information:');
    expect(result).toContain('- name: Test User');
    expect(result).toContain('- gender: female');
    expect(result).toContain('- location: SP');
    expect(result).toContain('- occupation: Engineer');
    expect(result).toContain('- favorite_food: Pizza');
    expect(result.split('\n').length).toBeGreaterThan(3);
  });

  it('omits personal fields that are empty', () => {
    configMock.config.PERSONAL_INFORMATION.gender = '';
    configMock.config.PERSONAL_INFORMATION.birthday = '';
    configMock.config.PERSONAL_INFORMATION.location = '';
    configMock.config.PERSONAL_INFORMATION.occupation = '';
    const repository = new ContextRepository();

    const result = repository.get({ channel: 'tui' });

    expect(result).toContain('- name: Test User');
    expect(result).not.toContain('gender:');
    expect(result).not.toContain('location:');
    expect(result).not.toContain('occupation:');
  });

  it('factory create returns a ContextRepository', () => {
    expect(ContextRepositoryFactory.create()).toBeInstanceOf(ContextRepository);
  });
});
