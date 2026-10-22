package dragonforce.utils
{
   import flash.utils.ByteArray;
   import flash.utils.Endian;
   
   public final class SWFExplorer
   {
      
      private static var criteria:int;
      
      private static const NOT_COMPRESSED:int = 70;
      
      private static const COMPRESSED:int = 67;
      
      private static const FULL:int = 63;
      
      private static const SYMBOLCLASS:int = 76;
      
      public static const CLASSES:String = "classes";
      
      public function SWFExplorer()
      {
         super();
         throw new Error("You shouldn\'t use the new operator!");
      }
      
      public static function parse(param1:ByteArray, param2:String = "classes") : Array
      {
         var _loc12_:Array = null;
         var _loc13_:int = 0;
         var _loc14_:int = 0;
         var _loc15_:int = 0;
         var _loc16_:String = null;
         var _loc3_:Array = new Array();
         param1.position = 0;
         var _loc4_:int = int(param1.readUnsignedByte());
         param1.position += 2;
         var _loc5_:int = param1.readByte();
         param1.endian = Endian.LITTLE_ENDIAN;
         var _loc6_:int = int(param1.readUnsignedInt());
         var _loc7_:ByteArray = new ByteArray();
         param1.readBytes(_loc7_,0);
         if(_loc4_ == SWFExplorer.COMPRESSED)
         {
            _loc7_.uncompress();
         }
         _loc7_.endian = Endian.LITTLE_ENDIAN;
         var _loc8_:int = _loc7_.readUnsignedByte() >> 3;
         _loc7_.position += Math.ceil(_loc8_ * 4 / 8) + 1;
         var _loc9_:int = _loc7_.readByte();
         var _loc10_:int = _loc7_.readShort();
         var _loc11_:Array = browseTables(_loc7_);
         if(param2 == SWFExplorer.CLASSES)
         {
            criteria = SWFExplorer.SYMBOLCLASS;
            _loc12_ = _loc11_.filter(filter);
            if(_loc12_.length)
            {
               _loc7_.position = _loc12_[0].offset;
               _loc14_ = int(_loc7_.readUnsignedShort());
               _loc13_ = 0;
               while(_loc13_ < _loc14_)
               {
                  _loc7_.readUnsignedShort();
                  _loc15_ = _loc7_.readByte();
                  _loc16_ = new String();
                  while(_loc15_ != 0)
                  {
                     _loc16_ += String.fromCharCode(_loc15_);
                     _loc15_ = _loc7_.readByte();
                  }
                  _loc3_.push(_loc16_);
                  _loc13_++;
               }
            }
         }
         return _loc3_;
      }
      
      private static function filter(param1:TagInfos, param2:int, param3:Array) : Boolean
      {
         return param1.tag == criteria;
      }
      
      private static function browseTables(param1:ByteArray) : Array
      {
         var _loc2_:int = 0;
         var _loc3_:int = 0;
         var _loc5_:TagInfos = null;
         var _loc4_:Array = new Array();
         while(true)
         {
            _loc2_ = param1.readShort() >> 6 & 0x03FF;
            if(!_loc2_)
            {
               break;
            }
            _loc5_ = new TagInfos();
            _loc5_.tag = _loc2_;
            _loc5_.offset = param1.position;
            param1.position -= 2;
            _loc3_ = param1.readShort() & 0x3F;
            if(_loc3_ < SWFExplorer.FULL)
            {
               param1.position += _loc3_;
            }
            else
            {
               _loc3_ = int(param1.readUnsignedInt());
               _loc5_.offset = param1.position;
               param1.position += _loc3_;
            }
            _loc5_.endOffset = param1.position;
            _loc4_.push(_loc5_);
         }
         return _loc4_;
      }
   }
}

final class TagInfos
{
   
   public var offset:int;
   
   public var endOffset:int;
   
   public var tag:int;
   
   public function TagInfos()
   {
      super();
   }
}
