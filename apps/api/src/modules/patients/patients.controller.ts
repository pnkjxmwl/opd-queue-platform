import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post } from '@nestjs/common';
import {
  CreatePatientRequest,
  UpdatePatientRequest,
  type Patient,
} from '@opd/contracts';
import { PatientsService } from './patients.service';
import { ZodBody } from '../../common/pipes/zod-validation.pipe';
import { CurrentAccount } from '../../common/decorators';
import type { AuthedAccount } from '../../common/auth-context';

@Controller('patients')
export class PatientsController {
  constructor(private readonly patients: PatientsService) {}

  @Get()
  list(@CurrentAccount() account: AuthedAccount): Promise<Patient[]> {
    return this.patients.list(account.id);
  }

  @Post()
  create(
    @CurrentAccount() account: AuthedAccount,
    @Body(new ZodBody(CreatePatientRequest)) body: CreatePatientRequest,
  ): Promise<Patient> {
    return this.patients.create(account.id, body);
  }

  @Patch(':id')
  update(
    @CurrentAccount() account: AuthedAccount,
    @Param('id') id: string,
    @Body(new ZodBody(UpdatePatientRequest)) body: UpdatePatientRequest,
  ): Promise<Patient> {
    return this.patients.update(account.id, id, body);
  }

  @HttpCode(204)
  @Delete(':id')
  remove(@CurrentAccount() account: AuthedAccount, @Param('id') id: string): Promise<void> {
    return this.patients.remove(account.id, id);
  }
}
