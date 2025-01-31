import { HttpStatus, INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { AuthModule } from '../src/auth/auth.module';
import { SpacesModule } from '../src/spaces/spaces.module';
import * as request from 'supertest';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { PrismaService } from '../src/prisma/prisma.service';
import { sign } from 'jsonwebtoken';
import { Profile, Space } from '@prisma/client';
import { v4 as uuid } from 'uuid';
import { readFile } from 'fs/promises';
import { resolve } from 'path';
import { ProfileSpaceModule } from '../src/profile-space/profile-space.module';

describe('SpacesController (e2e)', () => {
  let app: INestApplication;
  let testToken: string;
  let testSpace: Space;
  let testProfile: Profile;
  let configService: ConfigService;
  let prisma: PrismaService;
  const testImagePath = resolve(__dirname, './base_image.png');

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        SpacesModule,
        AuthModule,
        ProfileSpaceModule,
      ],
    }).compile();

    app = module.createNestApplication();

    await app.init();

    prisma = module.get<PrismaService>(PrismaService);
    configService = module.get<ConfigService>(ConfigService);

    await prisma.profile.deleteMany({});
    await prisma.user.deleteMany({});

    const testUser = await prisma.user.create({ data: { uuid: uuid() } });
    testProfile = await prisma.profile.create({
      data: {
        uuid: uuid(),
        userUuid: testUser.uuid,
        image: 'test image',
        nickname: 'test nickname',
      },
    });

    testToken = sign(
      { sub: testUser.uuid },
      configService.get<string>('JWT_ACCESS_SECRET'),
      { expiresIn: '5m' },
    );
  });

  beforeEach(async () => {
    await prisma.space.deleteMany({});
    await prisma.profileSpace.deleteMany({});

    testSpace = await prisma.space.create({
      data: {
        uuid: uuid(),
        name: 'test space',
        icon: configService.get<string>('APP_ICON_URL'),
      },
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it('/spaces (POST)', () => {
    const newSpace = {
      name: 'new test space',
      icon: testImagePath,
      iconContentType: 'image/png',
    };

    const imageUrlPattern = `^https\\:\\/\\/${configService.get<string>(
      'S3_BUCKET_NAME',
    )}\\.s3\\.${configService.get<string>(
      'AWS_REGION',
    )}\\.amazonaws\\.com\\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-`;
    const imageRegExp = new RegExp(imageUrlPattern);

    return request(app.getHttpServer())
      .post('/spaces')
      .auth(testToken, { type: 'bearer' })
      .field('name', newSpace.name)
      .field('profile_uuid', testProfile.uuid)
      .attach('icon', newSpace.icon, { contentType: newSpace.iconContentType })
      .expect(HttpStatus.CREATED)
      .expect((res) => {
        expect(res.body.message).toBe('Created');
        expect(res.body.statusCode).toBe(HttpStatus.CREATED);
        expect(res.body.data.uuid).toMatch(
          /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
        );
        expect(res.body.data.name).toBe(newSpace.name);
        expect(res.body.data.icon).toMatch(imageRegExp);
      });
  });

  it('/spaces (POST) without space image', () => {
    const newSpace = { name: 'new test space' };

    return request(app.getHttpServer())
      .post('/spaces')
      .auth(testToken, { type: 'bearer' })
      .send({ name: newSpace.name, profile_uuid: testProfile.uuid })
      .expect(HttpStatus.CREATED)
      .expect((res) => {
        expect(res.body.message).toBe('Created');
        expect(res.body.statusCode).toBe(HttpStatus.CREATED);
        expect(res.body.data.uuid).toMatch(
          /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
        );
        expect(res.body.data.name).toBe(newSpace.name);
        expect(res.body.data.icon).toBe(
          configService.get<string>('APP_ICON_URL'),
        );
      });
  });

  it('/spaces (POST) without profile uuid', () => {
    const newSpace = {
      name: 'new test space',
      icon: testImagePath,
      iconContentType: 'image/png',
    };

    return request(app.getHttpServer())
      .post('/spaces')
      .auth(testToken, { type: 'bearer' })
      .field('name', newSpace.name)
      .attach('icon', newSpace.icon, { contentType: newSpace.iconContentType })
      .expect(HttpStatus.BAD_REQUEST)
      .expect({ message: 'Bad Request', statusCode: HttpStatus.BAD_REQUEST });
  });

  it('/spaces (POST) without space name', () => {
    const newSpace = {
      icon: testImagePath,
      iconContentType: 'image/png',
    };

    return request(app.getHttpServer())
      .post('/spaces')
      .auth(testToken, { type: 'bearer' })
      .field('profile_uuid', testProfile.uuid)
      .attach('icon', newSpace.icon, { contentType: newSpace.iconContentType })
      .expect(HttpStatus.BAD_REQUEST)
      .expect({ message: 'Bad Request', statusCode: HttpStatus.BAD_REQUEST });
  });

  it('/spaces (POST) not logged in', () => {
    return request(app.getHttpServer())
      .post('/spaces')
      .expect(HttpStatus.UNAUTHORIZED)
      .expect({ message: 'Unauthorized', statusCode: HttpStatus.UNAUTHORIZED });
  });

  it("/spaces (POST) profile user doesn't have", async () => {
    const newSpace = {
      name: 'new test space',
      icon: testImagePath,
      iconContentType: 'image/png',
    };
    const newUser = await prisma.user.create({ data: { uuid: uuid() } });
    const newProfile = await prisma.profile.create({
      data: {
        uuid: uuid(),
        userUuid: newUser.uuid,
        image: 'test image',
        nickname: 'test nickname',
      },
    });

    return request(app.getHttpServer())
      .post('/spaces')
      .auth(testToken, { type: 'bearer' })
      .field('name', newSpace.name)
      .field('profile_uuid', newProfile.uuid)
      .attach('icon', newSpace.icon, { contentType: newSpace.iconContentType })
      .expect(HttpStatus.FORBIDDEN)
      .expect({ message: 'Forbidden', statusCode: HttpStatus.FORBIDDEN });
  });

  it('/spaces (POST) profilie not found', () => {
    const newSpace = {
      name: 'new test space',
      icon: testImagePath,
      iconContentType: 'image/png',
    };

    return request(app.getHttpServer())
      .post('/spaces')
      .auth(testToken, { type: 'bearer' })
      .field('name', newSpace.name)
      .field('profile_uuid', uuid())
      .attach('icon', newSpace.icon, { contentType: newSpace.iconContentType })
      .expect(HttpStatus.NOT_FOUND)
      .expect({ message: 'Not Found', statusCode: HttpStatus.NOT_FOUND });
  });

  it('/spaces/:space_uuid?profile_uuid={profile_uuid} (GET) space found', async () => {
    await prisma.profileSpace.create({
      data: { spaceUuid: testSpace.uuid, profileUuid: testProfile.uuid },
    });

    return request(app.getHttpServer())
      .get(`/spaces/${testSpace.uuid}?profile_uuid=${testProfile.uuid}`)
      .auth(testToken, { type: 'bearer' })
      .expect(HttpStatus.OK)
      .expect({
        message: 'OK',
        statusCode: HttpStatus.OK,
        data: testSpace,
      });
  });

  it('/spaces/:space_uuid?profile_uuid={profile_uuid} (GET) query profile_uuid needed', async () => {
    return request(app.getHttpServer())
      .get(`/spaces/${testSpace.uuid}`)
      .auth(testToken, { type: 'bearer' })
      .expect(HttpStatus.BAD_REQUEST)
      .expect({ message: 'Bad Request', statusCode: HttpStatus.BAD_REQUEST });
  });

  it('/spaces/:space_uuid?profile_uuid={profile_uuid} (GET) not logged in', async () => {
    await prisma.profileSpace.create({
      data: { spaceUuid: testSpace.uuid, profileUuid: testProfile.uuid },
    });

    return request(app.getHttpServer())
      .get(`/spaces/${testSpace.uuid}?profile_uuid=${testProfile.uuid}`)
      .expect(HttpStatus.UNAUTHORIZED)
      .expect({ message: 'Unauthorized', statusCode: HttpStatus.UNAUTHORIZED });
  });

  it("/spaces/:space_uuid?profile_uuid={profile_uuid} (GET) profile user doesn't have", async () => {
    const newUser = await prisma.user.create({ data: { uuid: uuid() } });
    const newProfile = await prisma.profile.create({
      data: {
        uuid: uuid(),
        userUuid: newUser.uuid,
        image: 'test image',
        nickname: 'test nickname',
      },
    });
    await prisma.profileSpace.create({
      data: { spaceUuid: testSpace.uuid, profileUuid: newProfile.uuid },
    });

    return request(app.getHttpServer())
      .get(`/spaces/${testSpace.uuid}?profile_uuid=${newProfile.uuid}`)
      .auth(testToken, { type: 'bearer' })
      .expect(HttpStatus.FORBIDDEN)
      .expect({ message: 'Forbidden', statusCode: HttpStatus.FORBIDDEN });
  });

  it('/spaces/:space_uuid?profile_uuid={profile_uuid} (GET) profile not existing', async () => {
    return request(app.getHttpServer())
      .get(`/spaces/${testSpace.uuid}?profile_uuid=${uuid()}`)
      .auth(testToken, { type: 'bearer' })
      .expect(HttpStatus.NOT_FOUND)
      .expect({ message: 'Not Found', statusCode: HttpStatus.NOT_FOUND });
  });

  it('/spaces/:space_uuid?profile_uuid={profile_uuid} (GET) findOne profile not joined space', () => {
    return request(app.getHttpServer())
      .get(`/spaces/${testSpace.uuid}?profile_uuid=${testProfile.uuid}`)
      .auth(testToken, { type: 'bearer' })
      .expect(HttpStatus.FORBIDDEN)
      .expect({ message: 'Forbidden', statusCode: HttpStatus.FORBIDDEN });
  });

  it('/spaces/:space_uuid?profile_uuid={profile_uuid} (GET) not existing space', () => {
    return request(app.getHttpServer())
      .get(`/spaces/${uuid()}?profile_uuid=${testProfile.uuid}`)
      .auth(testToken, { type: 'bearer' })
      .expect(HttpStatus.NOT_FOUND)
      .expect({ message: 'Not Found', statusCode: HttpStatus.NOT_FOUND });
  });

  it('/spaces/:space_uuid?profile_uuid={profile_uuid} (PATCH) update success', async () => {
    const newSpace = {
      name: 'new test space',
      icon: testImagePath,
      iconContentType: 'image/png',
    };
    await prisma.profileSpace.create({
      data: { spaceUuid: testSpace.uuid, profileUuid: testProfile.uuid },
    });
    const imageUrlPattern = `^https\\:\\/\\/${configService.get<string>(
      'S3_BUCKET_NAME',
    )}\\.s3\\.${configService.get<string>(
      'AWS_REGION',
    )}\\.amazonaws\\.com\\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-`;
    const imageRegExp = new RegExp(imageUrlPattern);

    return request(app.getHttpServer())
      .patch(`/spaces/${testSpace.uuid}?profile_uuid=${testProfile.uuid}`)
      .auth(testToken, { type: 'bearer' })
      .field('name', newSpace.name)
      .attach('icon', newSpace.icon, { contentType: newSpace.iconContentType })
      .expect(HttpStatus.OK)
      .expect((res) => {
        expect(res.body.message).toBe('OK');
        expect(res.body.statusCode).toBe(HttpStatus.OK);
        expect(res.body.data.uuid).toBe(testSpace.uuid);
        expect(res.body.data.name).toBe(newSpace.name);
        expect(res.body.data.icon).toMatch(imageRegExp);
      });
  });

  it('/spaces/:space_uuid?profile_uuid={profile_uuid} (PATCH) request without name', async () => {
    const newSpace = {
      icon: testImagePath,
      iconContentType: 'image/png',
    };
    const imageUrlPattern = `^https\\:\\/\\/${configService.get<string>(
      'S3_BUCKET_NAME',
    )}\\.s3\\.${configService.get<string>(
      'AWS_REGION',
    )}\\.amazonaws\\.com\\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-`;
    const imageRegExp = new RegExp(imageUrlPattern);
    await prisma.profileSpace.create({
      data: { spaceUuid: testSpace.uuid, profileUuid: testProfile.uuid },
    });

    return request(app.getHttpServer())
      .patch(`/spaces/${testSpace.uuid}?profile_uuid=${testProfile.uuid}`)
      .auth(testToken, { type: 'bearer' })
      .attach('icon', newSpace.icon, { contentType: newSpace.iconContentType })
      .expect(HttpStatus.OK)
      .expect((res) => {
        expect(res.body.message).toBe('OK');
        expect(res.body.statusCode).toBe(HttpStatus.OK);
        expect(res.body.data.uuid).toBe(testSpace.uuid);
        expect(res.body.data.name).toBe(testSpace.name);
        expect(res.body.data.icon).toMatch(imageRegExp);
      });
  });

  it('/spaces/:space_uuid?profile_uuid={profile_uuid} (PATCH) request without icon', async () => {
    const newSpace = { name: 'new test space' };
    await prisma.profileSpace.create({
      data: { spaceUuid: testSpace.uuid, profileUuid: testProfile.uuid },
    });

    return request(app.getHttpServer())
      .patch(`/spaces/${testSpace.uuid}?profile_uuid=${testProfile.uuid}`)
      .auth(testToken, { type: 'bearer' })
      .send({ name: newSpace.name })
      .expect(HttpStatus.OK)
      .expect({
        message: 'OK',
        statusCode: HttpStatus.OK,
        data: {
          uuid: testSpace.uuid,
          name: newSpace.name,
          icon: configService.get<string>('APP_ICON_URL'),
        },
      });
  });

  it('/spaces/:space_uuid?profile_uuid={profile_uuid} (PATCH) profile uuid needed', async () => {
    const newSpace = {
      name: 'new test space',
      icon: testImagePath,
      iconContentType: 'image/png',
    };

    return request(app.getHttpServer())
      .patch(`/spaces/${testSpace.uuid}`)
      .auth(testToken, { type: 'bearer' })
      .field('name', newSpace.name)
      .attach('icon', newSpace.icon, { contentType: newSpace.iconContentType })
      .expect(HttpStatus.BAD_REQUEST)
      .expect({ message: 'Bad Request', statusCode: HttpStatus.BAD_REQUEST });
  });

  it('/spaces/:space_uuid?profile_uuid={profile_uuid} (PATCH) unauthorized', async () => {
    const icon = await readFile(resolve(__dirname, './base_image.png'));
    const newSpace = { name: 'new test space', icon };

    return request(app.getHttpServer())
      .patch(`/spaces/${testSpace.uuid}?profile_uuid=${testProfile.uuid}`)
      .field('name', newSpace.name)
      .attach('icon', newSpace.icon)
      .expect(HttpStatus.UNAUTHORIZED)
      .expect({
        message: 'Unauthorized',
        statusCode: HttpStatus.UNAUTHORIZED,
      });
  });

  it("/spaces/:space_uuid?profile_uuid={profile_uuid} (PATCH) profile user doesn't have", async () => {
    const newSpace = {
      name: 'new test space',
      icon: testImagePath,
      iconContentType: 'image/png',
    };
    const newUser = await prisma.user.create({ data: { uuid: uuid() } });
    const newProfile = await prisma.profile.create({
      data: {
        uuid: uuid(),
        userUuid: newUser.uuid,
        image: 'test image',
        nickname: 'test nickname',
      },
    });
    await prisma.profileSpace.create({
      data: { spaceUuid: testSpace.uuid, profileUuid: newProfile.uuid },
    });

    return request(app.getHttpServer())
      .patch(`/spaces/${testSpace.uuid}?profile_uuid=${newProfile.uuid}`)
      .auth(testToken, { type: 'bearer' })
      .field('name', newSpace.name)
      .attach('icon', newSpace.icon, { contentType: newSpace.iconContentType })
      .expect(HttpStatus.FORBIDDEN)
      .expect({ message: 'Forbidden', statusCode: HttpStatus.FORBIDDEN });
  });

  it('/spaces/:space_uuid?profile_uuid={profile_uuid} (PATCH) profile not joined space', async () => {
    const newSpace = {
      name: 'new test space',
      icon: testImagePath,
      iconContentType: 'image/png',
    };
    const newUser = await prisma.user.create({ data: { uuid: uuid() } });
    const newProfile = await prisma.profile.create({
      data: {
        uuid: uuid(),
        userUuid: newUser.uuid,
        image: 'test image',
        nickname: 'test nickname',
      },
    });

    return request(app.getHttpServer())
      .patch(`/spaces/${testSpace.uuid}?profile_uuid=${newProfile.uuid}`)
      .auth(testToken, { type: 'bearer' })
      .field('name', newSpace.name)
      .attach('icon', newSpace.icon, { contentType: newSpace.iconContentType })
      .expect(HttpStatus.FORBIDDEN)
      .expect({ message: 'Forbidden', statusCode: HttpStatus.FORBIDDEN });
  });

  it('/spaces/:space_uuid?profile_uuid={profile_uuid} (PATCH) profile not found', () => {
    const newSpace = {
      name: 'new test space',
      icon: testImagePath,
      iconContentType: 'image/png',
    };

    return request(app.getHttpServer())
      .patch(`/spaces/${testSpace.uuid}?profile_uuid=${uuid()}`)
      .auth(testToken, { type: 'bearer' })
      .field('name', newSpace.name)
      .attach('icon', newSpace.icon, { contentType: newSpace.iconContentType })
      .expect(HttpStatus.NOT_FOUND)
      .expect({ message: 'Not Found', statusCode: HttpStatus.NOT_FOUND });
  });

  it('/spaces/:space_uuid/join (POST)', async () => {
    return request(app.getHttpServer())
      .post(`/spaces/${testSpace.uuid}/join`)
      .auth(testToken, { type: 'bearer' })
      .send({ profile_uuid: testProfile.uuid })
      .expect(HttpStatus.CREATED)
      .expect({
        message: 'Created',
        statusCode: HttpStatus.CREATED,
        data: testSpace,
      });
  });

  it('/spaces/:space_uuid/join (POST) profile uuid needed', async () => {
    return request(app.getHttpServer())
      .post(`/spaces/${testSpace.uuid}/join`)
      .auth(testToken, { type: 'bearer' })
      .expect(HttpStatus.BAD_REQUEST)
      .expect({
        message: 'Bad Request',
        statusCode: HttpStatus.BAD_REQUEST,
      });
  });

  it('/spaces/:space_uuid/join (POST) profile uuid wrong type', async () => {
    const number = 1;

    return request(app.getHttpServer())
      .post(`/spaces/${testSpace.uuid}/join`)
      .auth(testToken, { type: 'bearer' })
      .send({ profile_uuid: number })
      .expect(HttpStatus.BAD_REQUEST)
      .expect({
        message: 'Bad Request',
        statusCode: HttpStatus.BAD_REQUEST,
      });
  });

  it('/spaces/:space_uuid/join (POST) user not logged in', async () => {
    return request(app.getHttpServer())
      .post(`/spaces/${testSpace.uuid}/join`)
      .send({ profile_uuid: testProfile.uuid })
      .expect(HttpStatus.UNAUTHORIZED)
      .expect({
        message: 'Unauthorized',
        statusCode: HttpStatus.UNAUTHORIZED,
      });
  });

  it('/spaces/:space_uuid/join (POST) profile user not own', async () => {
    const newUser = await prisma.user.create({ data: { uuid: uuid() } });
    const newProfile = await prisma.profile.create({
      data: {
        uuid: uuid(),
        userUuid: newUser.uuid,
        image: 'test image',
        nickname: 'test nickname',
      },
    });

    return request(app.getHttpServer())
      .post(`/spaces/${testSpace.uuid}/join`)
      .auth(testToken, { type: 'bearer' })
      .send({ profile_uuid: newProfile.uuid })
      .expect(HttpStatus.FORBIDDEN)
      .expect({
        message: 'Forbidden',
        statusCode: HttpStatus.FORBIDDEN,
      });
  });

  it('/spaces/:space_uuid/join (POST) space not exist', async () => {
    return request(app.getHttpServer())
      .post(`/spaces/${uuid()}/join`)
      .auth(testToken, { type: 'bearer' })
      .send({ profile_uuid: testProfile.uuid })
      .expect(HttpStatus.FORBIDDEN)
      .expect({
        message: 'Forbidden',
        statusCode: HttpStatus.FORBIDDEN,
      });
  });

  it('/spaces/:space_uuid/join (POST) profile not found', async () => {
    return request(app.getHttpServer())
      .post(`/spaces/${testSpace.uuid}/join`)
      .auth(testToken, { type: 'bearer' })
      .send({ profile_uuid: uuid() })
      .expect(HttpStatus.NOT_FOUND)
      .expect({
        message: 'Not Found',
        statusCode: HttpStatus.NOT_FOUND,
      });
  });

  it('/spaces/:space_uuid/join (POST) already joined space', async () => {
    await prisma.profileSpace.create({
      data: {
        spaceUuid: testSpace.uuid,
        profileUuid: testProfile.uuid,
      },
    });

    return request(app.getHttpServer())
      .post(`/spaces/${testSpace.uuid}/join`)
      .auth(testToken, { type: 'bearer' })
      .send({ profile_uuid: testProfile.uuid })
      .expect(HttpStatus.CONFLICT)
      .expect({
        message: 'Conflict',
        statusCode: HttpStatus.CONFLICT,
      });
  });

  it('/spaces/:space_uuid/profiles/:profile_uuid (DELETE)', async () => {
    await prisma.profileSpace.create({
      data: {
        profileUuid: testProfile.uuid,
        spaceUuid: testSpace.uuid,
      },
    });

    return request(app.getHttpServer())
      .delete(`/spaces/${testSpace.uuid}/profiles/${testProfile.uuid}`)
      .auth(testToken, { type: 'bearer' })
      .expect(HttpStatus.OK)
      .expect({ message: 'OK', statusCode: HttpStatus.OK });
  });

  it('/spaces/:space_uuid/profiles/:profile_uuid (DELETE) user not logged in', async () => {
    await prisma.profileSpace.create({
      data: {
        profileUuid: testProfile.uuid,
        spaceUuid: testSpace.uuid,
      },
    });

    return request(app.getHttpServer())
      .delete(`/spaces/${testSpace.uuid}/profiles/${testProfile.uuid}`)
      .expect(HttpStatus.UNAUTHORIZED)
      .expect({ message: 'Unauthorized', statusCode: HttpStatus.UNAUTHORIZED });
  });

  it('/spaces/:space_uuid/profiles/:profile_uuid (DELETE) profile user not own', async () => {
    const newUser = await prisma.user.create({ data: { uuid: uuid() } });
    const newProfile = await prisma.profile.create({
      data: {
        uuid: uuid(),
        userUuid: newUser.uuid,
        image: 'test image',
        nickname: 'test nickname',
      },
    });
    await prisma.profileSpace.create({
      data: {
        profileUuid: testProfile.uuid,
        spaceUuid: testSpace.uuid,
      },
    });

    return request(app.getHttpServer())
      .delete(`/spaces/${testSpace.uuid}/profiles/${newProfile.uuid}`)
      .auth(testToken, { type: 'bearer' })
      .expect(HttpStatus.FORBIDDEN)
      .expect({ message: 'Forbidden', statusCode: HttpStatus.FORBIDDEN });
  });

  it('/spaces/:space_uuid/profiles/:profile_uuid (DELETE) profile user not own', async () => {
    await prisma.profileSpace.create({
      data: {
        profileUuid: testProfile.uuid,
        spaceUuid: testSpace.uuid,
      },
    });

    return request(app.getHttpServer())
      .delete(`/spaces/${testSpace.uuid}/profiles/${uuid()}`)
      .auth(testToken, { type: 'bearer' })
      .expect(HttpStatus.NOT_FOUND)
      .expect({ message: 'Not Found', statusCode: HttpStatus.NOT_FOUND });
  });

  it('/spaces/:space_uuid/profiles/:profile_uuid (DELETE) profile user not own', async () => {
    return request(app.getHttpServer())
      .delete(`/spaces/${testSpace.uuid}/profiles/${testProfile.uuid}`)
      .auth(testToken, { type: 'bearer' })
      .expect(HttpStatus.NOT_FOUND)
      .expect({ message: 'Not Found', statusCode: HttpStatus.NOT_FOUND });
  });

  it('/spaces/:space_uuid/profiles (GET)', async () => {
    await prisma.profileSpace.create({
      data: {
        profileUuid: testProfile.uuid,
        spaceUuid: testSpace.uuid,
      },
    });

    return request(app.getHttpServer())
      .get(
        `/spaces/${testSpace.uuid}/profiles?profile_uuid=${testProfile.uuid}`,
      )
      .auth(testToken, { type: 'bearer' })
      .expect(HttpStatus.OK)
      .expect((res) => {
        expect(res.body.message).toBe('OK');
        expect(res.body.statusCode).toBe(HttpStatus.OK);
        expect(res.body.data).toEqual(expect.arrayContaining([testProfile]));
      });
  });

  it('/spaces/:space_uuid/profiles (GET) profile uuid needed', async () => {
    return request(app.getHttpServer())
      .get(`/spaces/${testSpace.uuid}/profiles`)
      .auth(testToken, { type: 'bearer' })
      .expect(HttpStatus.BAD_REQUEST)
      .expect({ message: 'Bad Request', statusCode: HttpStatus.BAD_REQUEST });
  });

  it('/spaces/:space_uuid/profiles (GET) user not logged in', async () => {
    return request(app.getHttpServer())
      .get(`/spaces/${testSpace.uuid}/profiles`)
      .expect(HttpStatus.UNAUTHORIZED)
      .expect({ message: 'Unauthorized', statusCode: HttpStatus.UNAUTHORIZED });
  });

  it('/spaces/:space_uuid/profiles (GET) profile user not own', async () => {
    const newUser = await prisma.user.create({ data: { uuid: uuid() } });
    const newProfile = await prisma.profile.create({
      data: {
        uuid: uuid(),
        userUuid: newUser.uuid,
        image: 'test image',
        nickname: 'test nickname',
      },
    });

    return request(app.getHttpServer())
      .get(`/spaces/${testSpace.uuid}/profiles?profile_uuid=${newProfile.uuid}`)
      .auth(testToken, { type: 'bearer' })
      .expect(HttpStatus.FORBIDDEN)
      .expect({ message: 'Forbidden', statusCode: HttpStatus.FORBIDDEN });
  });

  it('/spaces/:space_uuid/profiles (GET) profile not joined space', async () => {
    return request(app.getHttpServer())
      .get(
        `/spaces/${testSpace.uuid}/profiles?profile_uuid=${testProfile.uuid}`,
      )
      .auth(testToken, { type: 'bearer' })
      .expect(HttpStatus.FORBIDDEN)
      .expect({ message: 'Forbidden', statusCode: HttpStatus.FORBIDDEN });
  });

  it('/spaces/:space_uuid/profiles (GET) profile not found', async () => {
    return request(app.getHttpServer())
      .get(`/spaces/${testSpace.uuid}/profiles?profile_uuid=${uuid()}`)
      .auth(testToken, { type: 'bearer' })
      .expect(HttpStatus.NOT_FOUND)
      .expect({ message: 'Not Found', statusCode: HttpStatus.NOT_FOUND });
  });
});
