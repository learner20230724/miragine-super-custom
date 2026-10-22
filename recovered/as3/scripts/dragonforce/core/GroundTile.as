package dragonforce.core
{
   import flash.display.BitmapData;
   import flash.geom.Vector3D;
   
   public class GroundTile
   {
      
      public var x:int;
      
      public var y:int;
      
      public var width:int;
      
      public var height:int;
      
      public var bitmapData:BitmapData;
      
      private var v0:Vector3D;
      
      private var v1:Vector3D;
      
      private var v2:Vector3D;
      
      private var v3:Vector3D;
      
      public var vectors:Vector.<Vector3D>;
      
      public function GroundTile(param1:BitmapData, param2:int = 0, param3:int = 0, param4:int = 0, param5:int = 0)
      {
         super();
         this.bitmapData = param1;
         this.x = param2;
         this.y = param3;
         this.width = param4;
         this.height = param5;
         this.v0 = new Vector3D(param2,param3,0);
         this.v1 = new Vector3D(param2 + param4,param3,0);
         this.v2 = new Vector3D(param2 + param4,param3 + param5,0);
         this.v3 = new Vector3D(param2,param3 + param5,0);
         this.vectors = new Vector.<Vector3D>();
         this.vectors.push(this.v0,this.v1,this.v2,this.v3);
      }
   }
}

