import { container } from '@sapphire/framework'
import { Role } from 'discord.js'
import { StringObject } from '../contants/emoji'
import { MemberRoles, ModeratorRoles, RegisterRoles } from '../contants/enum'

export const isModeratorRole = (r: Role) => (ModeratorRoles as StringObject)[r.name] !== undefined
export const isRegisterRole = (r: Role) => (RegisterRoles as StringObject)[r.name] !== undefined
export const isMemberRole = (r: Role) => (MemberRoles as StringObject)[r.name] !== undefined
export const isClanRole = (r: Role) => container.client.sessions.data.clans.some((s) => s.name === r.name)
