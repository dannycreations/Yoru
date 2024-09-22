import { container } from '@sapphire/framework'
import { Role } from 'discord.js'
import { MemberRoles, ModeratorRoles, RegisterRoles } from '../contants/enum'

export const isModeratorRole = (r: Role) => ModeratorRoles[r.name] !== undefined
export const isRegisterRole = (r: Role) => RegisterRoles[r.name] !== undefined
export const isMemberRole = (r: Role) => MemberRoles[r.name] !== undefined
export const isClanRole = (r: Role) => container.client.sessions.cache.clans.some((s) => s.name === r.name)
