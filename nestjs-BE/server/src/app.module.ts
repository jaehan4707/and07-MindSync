import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { BoardTreesGateway } from './board-trees/board-trees.gateway';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { PrismaModule } from './prisma/prisma.module';
import { TemporaryDatabaseModule } from './temporary-database/temporary-database.module';
import { ProfilesModule } from './profiles/profiles.module';
import { SpacesModule } from './spaces/spaces.module';
import { BoardsModule } from './boards/boards.module';
import { ScheduleModule } from '@nestjs/schedule';
import { UploadModule } from './upload/upload.module';
import { MongooseModule } from '@nestjs/mongoose';
import { BoardTreesModule } from './board-trees/board-trees.module';
import customEnv from './config/env';

@Module({
  imports: [
    AuthModule,
    UsersModule,
    PrismaModule,
    TemporaryDatabaseModule,
    ScheduleModule.forRoot(),
    ProfilesModule,
    SpacesModule,
    BoardsModule,
    UploadModule,
    MongooseModule.forRoot(customEnv.MONGODB_DATABASE_URI),
    BoardTreesModule,
  ],
  controllers: [AppController],
  providers: [AppService, BoardTreesGateway],
})
export class AppModule {}
