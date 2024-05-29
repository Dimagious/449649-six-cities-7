import { inject, injectable } from 'inversify';
import { DocumentType, types } from '@typegoose/typegoose';
import { Types } from 'mongoose';

import { OfferService } from './offer.service.interface.js';
import { EComponent } from '../../types/component.enum.js';
import { Logger } from '../../libs/logger/index.js';
import { OfferEntity } from './offer.entity.js';
import { CreateOfferDto } from './dto/create-offer.dto.js';
import { UpdateOfferDto } from './dto/update-offer.dto.js';
import { SortType } from '../../types/sort-type.enum.js';
import { DEFAULT_OFFER_COUNT, DEFAULT_OFFER_PREMIUM_COUNT } from './offer.constant.js';

@injectable()
export class DefaultOfferService implements OfferService {
  constructor(
    @inject(EComponent.Logger) private readonly logger: Logger,
    @inject(EComponent.OfferModel) private readonly offerModel: types.ModelType<OfferEntity>
  ) { }

  public async create(dto: CreateOfferDto): Promise<DocumentType<OfferEntity>> {
    const result = await this.offerModel.create(dto);
    this.logger.info(`New offer created: ${dto.title}`);

    return result;
  }

  public async findOfferById(offerId: string): Promise<DocumentType<OfferEntity> | null> {
    const result = await this.offerModel.aggregate([
      {
        $match: { _id: new Types.ObjectId(offerId) }
      },
      {
        $lookup: {
          from: 'comments',
          localField: '_id',
          foreignField: 'offerId',
          as: 'comments',
        }
      },
      {
        $addFields: {
          reviewCount: { $size: '$comments' },
          rating: { $avg: '$comments.rating' },
        }
      },
      {
        $unset: 'comments'
      }
    ])
      .exec();


    return result[0] ?? null;
  }


  public async find(): Promise<DocumentType<OfferEntity>[]> {
    return this.offerModel.aggregate([
      {
        $lookup: {
          from: 'comments',
          localField: '_id',
          foreignField: 'offerId',
          as: 'comments',
        }
      },
      {
        $addFields: {
          reviewCount: { $size: '$comments' },
          rating: { $avg: '$comments.rating' },
        }
      },
      { $unset: ['comments'] },
      { $sort: { createdAt: SortType.Down } },
      { $limit: DEFAULT_OFFER_COUNT }
    ])
      .exec();
  }


  public async getPremiumOffers(): Promise<DocumentType<OfferEntity>[]> {
    return this.offerModel
      .find({ isPremium: true })
      .sort({ createdAt: SortType.Down })
      .limit(DEFAULT_OFFER_PREMIUM_COUNT)
      .populate(['userId'])
      .exec();
  }

  public async updateById(offerId: string, dto: UpdateOfferDto): Promise<DocumentType<OfferEntity> | null> {
    return this.offerModel
      .findByIdAndUpdate(offerId, dto, { new: true })
      .populate(['userId'])
      .exec();
  }

  public async deletebyId(offerId: string): Promise<DocumentType<OfferEntity> | null> {
    return this.offerModel
      .findByIdAndDelete(offerId)
      .exec();
  }

  public async incCommentCount(offerId: string): Promise<DocumentType<OfferEntity> | null> {
    return this.offerModel
      .findByIdAndUpdate(offerId, {
        '$inc': {
          reviewCount: 1,
        }
      }, { new: true }).exec();
  }

  public async exists(documentId: string): Promise<boolean> {
    return (await this.offerModel.exists({ _id: documentId })) !== null;
  }

  public async getRating(offerId: string): Promise<number> {
    const result = await this.offerModel.aggregate([
      {
        $match: { _id: new Types.ObjectId(offerId) }
      },
      {
        $lookup: {
          from: 'comments',
          let: { offerId: '$_id' },
          pipeline: [
            { $match: { offerId: offerId } },
            { $project: { _id: null, rating: 1 } },
          ],
          as: 'comments',
        }
      },
      {
        $addFields: {
          numberOfComments: { $size: '$comments' },
          commentsSum: {
            $reduce: {
              input: '$comments',
              initialValue: 0,
              in: { $sum: ['$$value', '$$this.rating'] },
            },
          },
        },
      },
      {
        $addFields: {
          rating: { $round: [{ $divide: ['$commentsSum', '$numberOfComments'] }, 1] }
        },
      },
      {
        $unset: ['commentsLength', 'commentsSum', 'comments']
      }
    ])
      .exec();

    return result?.[0]?.rating ?? null;
  }

  public async updateRating(
    offerId: string
  ): Promise<DocumentType<OfferEntity> | null> {
    const rating = await this.getRating(offerId);

    if (!rating) {
      return null;
    }

    return this.offerModel
      .findByIdAndUpdate(offerId, { $set: { rating: rating } }, { new: true })
      .exec();
  }
}
